"""意图分流（P5-A）：单次 DeepSeek 分类 + 中文关键词启发式兜底。

契约（docs/plan-p5.md §2.1）：
    classify(q) -> {"intent": knowledge|data|policy|copywriting|general,
                    "target": rag|agent,
                    "reason": "一句话中文理由（供 chip 展示）"}

路由规则（非对称，防误伤）：data/policy/copywriting → agent；knowledge/general → rag。
延迟目标 <1.5s：temperature=0、max_tokens 小、LLM 预算超时即降级。
LLM 调用失败或 JSON 解析失败 → 关键词兜底；本模块任何路径都不抛异常，
端点层（api_intent.py）再包一层 catch-all 返回 general，保证永不 500。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

# 读取 backend/.env 中的密钥（不进 git；与 main.py 同一模式，层级多一层 agent/）
load_dotenv(Path(__file__).parent.parent.parent / ".env")

logger = logging.getLogger("shop-copilot.intent")

# 五类意图；路由表集中在此处，intent → target 一处维护
INTENTS = ("knowledge", "data", "policy", "copywriting", "general")
TARGET_OF: dict[str, str] = {
    "data": "agent",
    "policy": "agent",
    "copywriting": "agent",
    "knowledge": "rag",
    "general": "rag",
}
_LABEL = {
    "data": "数据查询",
    "policy": "合规检查",
    "copywriting": "文案创作",
    "knowledge": "知识问答",
    "general": "通用问题",
}

# LLM 端到端预算（秒）：保证 /v1/intent 总延迟 <1.5s，超时立即走关键词兜底
LLM_BUDGET_S = 1.3

SYSTEM_PROMPT = """你是电商运营助手的意图分类器。把用户问题严格分类为以下五类之一：
- data：查经营数据或业务状态（订单/库存/价格/物流/退款进度/售后/GMV/销售额等）
- policy：平台规则与合规问题（退款规则/违规/处罚/保证金/资质等）
- copywriting：创作请求（商品标题/文案/卖点/话术/描述等）
- knowledge：概念定义与方法论等知识问答（如"DSR 评分是什么"）
- general：寒暄、闲聊或无法归类

只输出严格 JSON，禁止任何解释、代码围栏或额外文字，格式：
{"intent":"data","reason":"查订单退款进度，属业务数据查询"}
reason 为一句简短中文（不超过 20 字）。"""

# 关键词启发式兜底，元组顺序即判定优先级
# （"退款进度"归 data，必须整组先于 policy 的"退款"判定；
#  "销售额" 为计划书 data 示例「今天销售额多少」补集，其余严格按 §2.1 清单）
_FALLBACK_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("data", ("订单", "库存", "价格", "物流", "退款进度", "售后", "GMV", "数据", "销售额", "查")),
    ("policy", ("退款", "违规", "处罚", "合规", "保证金")),
    ("copywriting", ("标题", "文案", "卖点", "话术")),
)


def _build(intent: str, reason: str) -> dict[str, str]:
    """组装契约返回体（intent → target 映射统一走 TARGET_OF）。"""
    return {"intent": intent, "target": TARGET_OF[intent], "reason": reason}


def _extract_json(text: str) -> dict[str, Any] | None:
    """从 LLM 输出提取第一个 {...} 块并解析；容忍 ```json 围栏与前后杂文。"""
    cleaned = re.sub(r"```[a-zA-Z]*", "", text)
    decoder = json.JSONDecoder()
    idx = cleaned.find("{")
    while idx >= 0:
        try:
            obj, _end = decoder.raw_decode(cleaned[idx:])
        except json.JSONDecodeError:
            idx = cleaned.find("{", idx + 1)  # 第一个 { 不是合法 JSON，试下一个
            continue
        return obj if isinstance(obj, dict) else None
    return None


def fallback_classify(q: str) -> dict[str, str]:
    """中文关键词启发式兜底（LLM 失败/坏 JSON 时使用），纯同步、零网络。"""
    for intent, keywords in _FALLBACK_RULES:
        for kw in keywords:
            if kw in q:
                return _build(intent, f"关键词命中「{kw}」→{_LABEL[intent]}")
    return _build("knowledge", "未命中业务关键词，按知识问答处理")


def _parse_llm_content(content: str) -> dict[str, str] | None:
    """解析 LLM 返回的 JSON；非法 intent/坏 JSON 返回 None（由调用方降级兜底）。"""
    obj = _extract_json(content)
    if obj is None:
        logger.warning("意图分类 JSON 解析失败，转关键词兜底: %.120r", content)
        return None
    intent = obj.get("intent")
    if intent not in INTENTS:
        logger.warning("意图分类 intent 非法 %r，转关键词兜底", intent)
        return None
    reason = obj.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        reason = f"模型判定为{_LABEL[intent]}"
    return _build(str(intent), reason.strip())


async def _llm_classify(q: str) -> dict[str, str] | None:
    """单次 DeepSeek chat completion（temperature=0，小 max_tokens）；None = 需兜底。"""
    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key:
        logger.warning("缺少 DEEPSEEK_API_KEY，意图分类转关键词兜底")
        return None
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": q},
        ],
        "temperature": 0,
        "max_tokens": 120,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=1.0)) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
    except httpx.HTTPError as exc:
        logger.warning("意图分类连接 DeepSeek 失败，转关键词兜底: %s", exc)
        return None
    if resp.status_code != 200:
        logger.warning("意图分类 DeepSeek 返回 %s，转关键词兜底", resp.status_code)
        return None
    try:
        content = resp.json()["choices"][0]["message"].get("content") or ""
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        logger.warning("意图分类响应结构异常，转关键词兜底: %s", exc)
        return None
    return _parse_llm_content(str(content))


async def classify(q: str) -> dict[str, str]:
    """意图分流主入口：LLM 分类 → 失败/坏 JSON/超时转关键词兜底；任何情况不抛异常。"""
    try:
        result = await asyncio.wait_for(_llm_classify(q), timeout=LLM_BUDGET_S)
    except asyncio.TimeoutError:
        logger.warning("意图分类 LLM 超时(%.1fs)，转关键词兜底", LLM_BUDGET_S)
        result = None
    except Exception as exc:  # 防御：一切意外转兜底并记录，不静默吞掉
        logger.exception("意图分类未预期异常，转关键词兜底: %s", exc)
        result = None
    if result is not None:
        return result
    return fallback_classify(q if isinstance(q, str) else "")
