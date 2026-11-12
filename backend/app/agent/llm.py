"""DeepSeek 共享 LLM 客户端（异步，含重试与友好错误）。

被 graph.py 的各个节点复用：意图路由、售前/售后 specialist、终审、工单。
- 密钥只在 Python 层（backend/.env），与前端无关。
- 错误统一抛 ProblemException（友好文案，技术细节进日志），对齐 errors.py。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

import httpx

from ..errors import config_error, upstream_error

logger = logging.getLogger("shop-copilot.agent.llm")

DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")

_RETRYABLE = (429, 500, 502, 503, 504)


class _LLMUnavailable(Exception):
    """内部信号：连接/解析失败，已重试耗尽。"""


def _tool_schemas(tools: list[Any]) -> list[dict]:
    """把 Tool 注册对象转成 OpenAI tools 参数（兼容我们的 Tool.schema()）。"""
    return [t.schema() for t in tools]


async def chat(
    messages: list[dict],
    *,
    tools: list[Any] | None = None,
    temperature: float = 0.0,
    json_mode: bool = False,
) -> dict:
    """调用 DeepSeek，返回 choices[0].message（含 content / tool_calls）。

    - 缺 key → 抛 config_error（友好话术）
    - 上游 429/5xx/网络错误 → 重试 4 次后退避，仍失败抛 upstream_error
    - 非 JSON 响应 → 抛 upstream_error
    - json_mode=True → 强制 JSON 输出（DeepSeek response_format，需 prompt 含"json"字样）
    """
    if not DEEPSEEK_API_KEY:
        raise config_error()

    payload: dict[str, Any] = {
        "model": DEEPSEEK_MODEL,
        "messages": messages,
        "temperature": temperature,
    }
    if tools:
        payload["tools"] = _tool_schemas(tools)
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=10.0)) as client:
        resp = None
        for attempt in range(4):
            try:
                resp = await client.post(
                    f"{DEEPSEEK_BASE_URL}/chat/completions",
                    json=payload,
                    headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
                )
                if resp.status_code == 200:
                    break
                if resp.status_code not in _RETRYABLE:
                    break
            except httpx.HTTPError as exc:
                logger.warning("LLM 连接失败(attempt %s): %s", attempt, exc)
                resp = None
            if attempt < 3:
                await asyncio.sleep(1.0 * (attempt + 1))

        if resp is None:
            raise upstream_error(502)
        if resp.status_code != 200:
            logger.warning("LLM 非 200: status=%s body=%s", resp.status_code, resp.text[:300])
            raise upstream_error(resp.status_code)
        try:
            data = resp.json()
            return data["choices"][0]["message"]
        except (ValueError, KeyError, IndexError) as exc:
            logger.warning("LLM 响应无法解析: %s", exc)
            raise upstream_error(502) from exc


async def chat_text(
    messages: list[dict],
    *,
    temperature: float = 0.0,
) -> str:
    """返回纯文本 content（用于终审/追问等不需要工具的场景）。"""
    msg = await chat(messages, temperature=temperature)
    return (msg.get("content") or "").strip()


async def chat_json(
    messages: list[dict],
    *,
    temperature: float = 0.0,
) -> dict:
    """要求结构化输出：强制 JSON 模式 + 兜底正则解析（模型可能包 ```json 围栏）。"""
    import re

    msg = await chat(messages, temperature=temperature, json_mode=True)
    text = (msg.get("content") or "").strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    return {"raw": text}
