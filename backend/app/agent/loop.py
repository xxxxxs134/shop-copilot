"""店智 Copilot — 手写 ReAct 循环（D1 决策：不用 LangChain/LangGraph）。

流程（每轮最多 MAX_STEPS=5 次工具调用）：
1. 组 messages（system + history + user）
2. 调 DeepSeek（带 tools 参数）
3. 若返回 tool_calls → 逐个执行工具 → 追加 tool message → 回到 2
4. 若返回 content → 流式 emit delta 事件 → emit done 事件

事件协议（SSE data 字段的 JSON）：
  {"type":"step","tool":"kb_search","args":{...}}          — 工具开始
  {"type":"step_result","tool":"kb_search","summary":"..."} — 工具结果摘要
  {"type":"delta","text":"淘宝"}                           — 流式文本片段
  {"type":"done","citations":[{"title":"...","category":"..."}]}  — 结束+引用
  {"type":"error","message":"..."}                         — 错误
"""

from __future__ import annotations

import json
import os
from typing import AsyncIterator

import httpx

from .tools import REGISTRY, list_schemas

MAX_STEPS = 5
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")

AGENT_SYSTEM = """你是店智 Copilot，一位专业电商运营 AI 助手。

原则：
- 先用工具查数据或检索知识库，再给建议，不要凭空猜测
- 涉及具体数字/规则时，引用 [1][2] 形式角标标注依据来源
- 用简洁中文回答，结构清晰，重点突出
- 数据解读要给出可操作的下一步建议

当前可用工具：
- kb_search：知识库检索（平台规则、运营方法论）
- data_query：查询店铺经营数据（GMV/订单/访客/转化率/退款率/热销品/流量来源）
- copywriting：生成商品文案
- policy_check：检查运营场景是否违规
"""


async def run_agent(
    user_text: str,
    history: list[dict],
) -> AsyncIterator[dict]:
    """ReAct 主循环，产出事件字典流（供 SSE 序列化）。"""
    if not DEEPSEEK_API_KEY:
        yield {"type": "error", "message": "缺少 DEEPSEEK_API_KEY，请在 backend/.env 配置后重启后端"}
        return

    messages = [
        {"role": "system", "content": AGENT_SYSTEM},
        *history,
        {"role": "user", "content": user_text},
    ]
    tools = list_schemas()

    async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=10.0)) as client:
        for step in range(MAX_STEPS):
            # 调 DeepSeek（非流式，便于解析 tool_calls）
            payload = {
                "model": DEEPSEEK_MODEL,
                "messages": messages,
                "tools": tools,
                "stream": False,
            }
            try:
                resp = await client.post(
                    f"{DEEPSEEK_BASE_URL}/chat/completions",
                    json=payload,
                    headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
                )
                if resp.status_code != 200:
                    yield {"type": "error", "message": f"DeepSeek 返回 {resp.status_code}: {resp.text[:300]}"}
                    return
                data = resp.json()
            except httpx.HTTPError as exc:
                yield {"type": "error", "message": f"连接 DeepSeek 失败: {exc}"}
                return

            msg = data["choices"][0]["message"]
            tool_calls = msg.get("tool_calls") or []

            if not tool_calls:
                # 无工具调用 → 最终答案，流式输出
                content = msg.get("content", "") or ""
                # 简易流式：按字符块切分
                chunk_size = 8
                for i in range(0, len(content), chunk_size):
                    yield {"type": "delta", "text": content[i : i + chunk_size]}
                yield {"type": "done", "citations": []}  # TODO: 从 kb_search 结果提取引用
                return

            # 有工具调用 → 逐个执行
            messages.append(msg)  # assistant 消息（含 tool_calls）
            for tc in tool_calls:
                fn_name = tc["function"]["name"]
                try:
                    fn_args = json.loads(tc["function"]["arguments"] or "{}")
                except json.JSONDecodeError:
                    fn_args = {}

                yield {"type": "step", "tool": fn_name, "args": fn_args}

                if fn_name not in REGISTRY:
                    result = json.dumps({"error": f"未知工具: {fn_name}"}, ensure_ascii=False)
                else:
                    result = REGISTRY[fn_name].call(fn_args)

                # 结果摘要（前 120 字）
                summary = result[:120] + ("…" if len(result) > 120 else "")
                yield {"type": "step_result", "tool": fn_name, "summary": summary}

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

        # 超出最大步数
        yield {"type": "error", "message": f"已达最大工具调用步数（{MAX_STEPS}），请简化问题或分步提问"}
