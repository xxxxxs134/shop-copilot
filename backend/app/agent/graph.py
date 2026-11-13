"""多 Agent 客服编排（LangGraph StateGraph）。

对齐参考项目：
- RTY798/ai-customer-service-agent：StateGraph + 纯函数 agent 节点 + 思考链(thought_chain) + escalation 工单
- LoongSuite 电商客服：intent_router → presales|aftersales|clarify → response_review

图结构（售前/售后分流 + 投诉升级 + 思考链留痕）：
    START → router → 条件边: clarify | presales | aftersales | escalation
                    clarify → END（追问）
                    presales / aftersales → review
                    escalation → review（生成工单后汇入终审）
                    review → END

- 售前/售后工具集完全隔离（不同 Agent 不同能力）
- thought_chain：每个节点留痕 {agent,status,input,output,detail}，供前端过程可视化 + 审计
- escalation：投诉生成结构化工单（工单号/类别/紧急度/建议动作）
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any, TypedDict

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from . import router as router_mod
from .llm import chat, chat_json, chat_text
from .tools import REGISTRY

logger = logging.getLogger("shop-copilot.agent.graph")

MAX_STEPS = 5


# ── 状态 ──────────────────────────────────────────────

class AgentState(TypedDict):
    # 输入：历史 + 最新 user 消息（纯 dict，节点只读，不在此图内追加）
    messages: list[dict]
    intent: str            # presales / aftersales / escalation / clarify
    confidence: float
    draft: str             # specialist 草稿
    evidence: list[dict]   # 工具证据（传给终审，防幻觉）
    kb_hits: list[dict]    # 知识库命中（供 [n] 引用溯源）
    escalation_ticket: dict | None   # 投诉工单
    thought_chain: list[dict]  # 思考链（节点显式累积，不用 reducer——Checkpointer 跨轮不串）
    final: str             # 终审回复（前端取这个）


def _thought(agent: str, input_: str, output: str, detail: str = "") -> dict:
    """统一思考链条目（对齐 RTY798 thought_chain）。"""
    return {"agent": agent, "status": "completed", "input": input_, "output": output, "detail": detail}


# ── 工具子集（售前/售后隔离）──────────────────────────

def _tools(*names: str) -> list[Any]:
    return [REGISTRY[n] for n in names if n in REGISTRY]

PRESALES_TOOLS = _tools("product_lookup", "kb_search")
AFTERSALES_TOOLS = _tools(
    "order_lookup", "refund_flow", "modify_address",
    "intercept_logistics", "return_exchange", "kb_search",
)

PRESALES_SYSTEM = """你是电商店铺的售前客服，接待的是准备下单的客户。
职责：介绍商品、回答价格/规格/库存/发货时间、根据客户需求推荐合适商品。
- 先用工具查商品/库存/知识库，再回答，不要凭空编造商品信息
- 推荐时给出 1-3 个选项，并说明推荐理由（贴合客户说的需求）
- 用简洁、亲切的中文，不要暴露任何内部技术细节"""

AFTERSALES_SYSTEM = """你是电商店铺的售后客服，接待的是已下单或有售后问题的客户。
职责：查订单/物流、处理退款退货、解答售后政策、安抚情绪。
- 先用工具查订单/政策，再回答，涉及具体数字要准确
- 客户情绪激动时先安抚一句，再给解决方案
- 涉及退款/改址等操作时，说明需要客户确认后才能执行
- 用简洁、温和的中文，不要暴露任何内部技术细节"""

ESCALATION_PROMPT = """你是电商客服的投诉升级处理专员。客户的问题需要转接人工客服处理。
请分析客户的投诉，生成结构化工单信息。
只输出 JSON：{"ticket_summary": "问题简述（20字内）", "issue_category": "问题类别", "detail": "问题详细描述", "urgency": "high/medium/low", "suggested_action": "建议处理方式"}"""

REVIEW_SYSTEM = """你是客服回复的终审员。根据客服草稿和工具查到的证据，生成最终回复。
规则：
1. 只保留有工具证据支持的信息，草稿里没有证据支撑的猜测一律删除
2. 如果提供了知识库证据（[1][2]...），回答中涉及这些内容时用 [n] 角标标注来源，客户可点开核对
3. 语气统一为亲切、专业的中文客服口吻
4. 直接输出最终回复，不要任何前缀或解释"""


# ── 节点 ──────────────────────────────────────────────

async def intent_router(state: AgentState) -> dict:
    """意图路由：售前 / 售后 / 投诉升级 / 澄清。"""
    intent, confidence = await router_mod.classify(state["messages"])
    return {
        "intent": intent,
        "confidence": confidence,
        "thought_chain": [_thought("router", state["messages"][-1].get("content", ""), intent, f"置信度 {confidence:.2f}")],
    }


async def clarify_node(state: AgentState) -> dict:
    """意图不明 → 生成一句追问，不误进专业 Agent。"""
    msgs = [
        {"role": "system", "content": "客户的问题意图不明确。用一句话友好地追问：客户是想咨询/选购商品，还是查询已有订单或售后问题？直接输出追问，不要前缀。"},
        *state["messages"],
    ]
    question = await chat_text(msgs, temperature=0.0)
    final = question or "请问您是想咨询商品，还是查询已有订单呢？"
    return {
        "final": final,
        "thought_chain": [*state.get("thought_chain", []), _thought("clarify", "", final, "意图不明，追问澄清")],
    }


async def _run_react(messages: list[dict], tools: list[Any], system: str) -> tuple[str, list[dict], list[dict]]:
    """ReAct 循环：返回 (最终文本, 工具证据, 知识库命中)。kb_search 结果单独收集供 [n] 引用。"""
    msgs = [{"role": "system", "content": system}, *messages]
    evidence: list[dict] = []
    kb_hits: list[dict] = []
    for _ in range(MAX_STEPS):
        msg = await chat(msgs, tools=tools, temperature=0.3)
        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            return (msg.get("content") or "").strip(), evidence, kb_hits
        msgs.append({"role": "assistant", "content": msg.get("content"), "tool_calls": tool_calls})
        for tc in tool_calls:
            fn = tc.get("function", {})
            name = fn.get("name", "")
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            if name in REGISTRY:
                # 同步工具（含 retrieve/embedding）放线程池，避免阻塞事件循环
                result = await asyncio.to_thread(REGISTRY[name].call, args)
                # 收集知识库命中（供终审 [n] 引用 + 前端 CitationCard）
                if name == "kb_search":
                    try:
                        parsed = json.loads(result)
                        for item in parsed.get("items", []):
                            kb_hits.append({
                                "title": item.get("title", ""),
                                "category": item.get("category", ""),
                                "text": item.get("text", ""),
                            })
                    except (json.JSONDecodeError, TypeError):
                        pass
            else:
                result = json.dumps({"error": f"未知工具: {name}"}, ensure_ascii=False)
            # 600 字：终审要看全关键数字（退款回执/库存/运单），200 会截断
            evidence.append({"tool": name, "args": args, "result": result[:600]})
            msgs.append({"role": "tool", "tool_call_id": tc.get("id", ""), "content": result})
    return "", evidence, kb_hits


async def presales_node(state: AgentState) -> dict:
    text, evidence, kb_hits = await _run_react(state["messages"], PRESALES_TOOLS, PRESALES_SYSTEM)
    return {
        "draft": text,
        "evidence": evidence,
        "kb_hits": kb_hits,
        "thought_chain": [*state.get("thought_chain", []), _thought("presales", state["messages"][-1].get("content", ""), text[:80], f"调用 {len(evidence)} 次工具")],
    }


async def aftersales_node(state: AgentState) -> dict:
    text, evidence, kb_hits = await _run_react(state["messages"], AFTERSALES_TOOLS, AFTERSALES_SYSTEM)
    return {
        "draft": text,
        "evidence": evidence,
        "kb_hits": kb_hits,
        "thought_chain": [*state.get("thought_chain", []), _thought("aftersales", state["messages"][-1].get("content", ""), text[:80], f"调用 {len(evidence)} 次工具")],
    }


async def escalation_node(state: AgentState) -> dict:
    """投诉 → 生成结构化工单（对齐 RTY798 escalation_agent）。"""
    parsed = await chat_json(
        [{"role": "system", "content": ESCALATION_PROMPT}, *state["messages"]],
        temperature=0.2,
    )
    ticket = {
        "ticket_id": f"TK-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "timestamp": datetime.now().isoformat(),
        "ticket_summary": parsed.get("ticket_summary", "客户投诉"),
        "issue_category": parsed.get("issue_category", "投诉"),
        "detail": parsed.get("detail", ""),
        "urgency": parsed.get("urgency", "medium"),
        "suggested_action": parsed.get("suggested_action", ""),
    }
    return {
        "escalation_ticket": ticket,
        "thought_chain": [*state.get("thought_chain", []), _thought(
            "escalation",
            state["messages"][-1].get("content", ""),
            f"已生成工单 {ticket['ticket_id']}",
            f"类别:{ticket['issue_category']} 紧急度:{ticket['urgency']}",
        )],
    }


async def review_node(state: AgentState) -> dict:
    """终审：过滤无证据内容 + 统一语气；有工单则告知已转人工。

    幻觉防御（硬保证，不靠 LLM 自觉）：
    - 无工具证据 + 无知识库命中 → 强制拒答
    - 有知识库命中但答案无 [n] → 记警告日志
    """
    ticket = state.get("escalation_ticket")
    if ticket:
        msgs = [
            {"role": "system", "content": "你是客服终审员。客户问题已升级为工单并转交人工客服。用温和、专业的语气告知客户已受理，并给出工单号。直接输出回复，不要前缀。"},
            {"role": "user", "content": f"工单号:{ticket['ticket_id']} 问题类别:{ticket['issue_category']} 紧急度:{ticket['urgency']} 客户原话:{state['messages'][-1].get('content','')}"},
        ]
        final = await chat_text(msgs, temperature=0.2)
        final = (final or "您的问题已受理，我们会尽快处理。").strip()
        return {
            "final": final,
            "thought_chain": [*state.get("thought_chain", []), _thought("review", "", final[:80], "终审完成（工单）")],
        }

    evidence = state.get("evidence", [])
    kb_hits = state.get("kb_hits", [])

    # 硬校验①：specialist 一个工具都没调 → 它在凭模型知识编造，强制拒答
    if not evidence and not kb_hits:
        final = "抱歉，这个问题我暂时没有查到确切信息，建议您联系人工客服进一步确认。"
        return {
            "final": final,
            "thought_chain": [*state.get("thought_chain", []), _thought("review", "", final[:80], "无工具证据，拒答")],
        }

    evidence_block = "\n".join(
        f"- [{e['tool']}] {e['result']}" for e in evidence
    ) or "（无工具证据）"
    kb_block = ""
    if kb_hits:
        lines = []
        for i, h in enumerate(kb_hits, 1):
            lines.append(f"[{i}] {h.get('title','')}（{h.get('category','')}）：{h.get('text','')}")
        kb_block = "\n\n知识库证据（回答时用 [n] 角标引用）：\n" + "\n".join(lines)
    msgs = [
        {"role": "system", "content": REVIEW_SYSTEM},
        {"role": "user", "content": f"客服草稿：\n{state.get('draft', '')}\n\n工具证据：\n{evidence_block}{kb_block}"},
    ]
    final = await chat_text(msgs, temperature=0.2)

    # 硬校验②：有知识库命中但答案没有 [n] → 记警告（引用强制的可观测性）
    if kb_hits and "[" not in final:
        logger.warning("答案缺少 [n] 引用（有 %d 条知识库命中）: %s", len(kb_hits), final[:80])

    final = (final or state.get("draft") or "抱歉，我暂时无法回答，请稍后再试。").strip()
    return {
        "final": final,
        "thought_chain": [*state.get("thought_chain", []), _thought("review", (state.get("draft") or "")[:80], final[:80], "终审完成")],
    }


# ── 路由条件 ─────────────────────────────────────────

def _route(state: AgentState) -> str:
    return state.get("intent", "clarify")


# ── 构建 ─────────────────────────────────────────────

def build_graph():
    builder = StateGraph(AgentState)
    builder.add_node("router", intent_router)
    builder.add_node("clarify", clarify_node)
    builder.add_node("presales", presales_node)
    builder.add_node("aftersales", aftersales_node)
    builder.add_node("escalation", escalation_node)
    builder.add_node("review", review_node)

    builder.add_edge(START, "router")
    builder.add_conditional_edges("router", _route, {
        "clarify": "clarify",
        "presales": "presales",
        "aftersales": "aftersales",
        "escalation": "escalation",
    })
    builder.add_edge("presales", "review")
    builder.add_edge("aftersales", "review")
    builder.add_edge("escalation", "review")
    builder.add_edge("clarify", END)
    builder.add_edge("review", END)
    return builder.compile(checkpointer=MemorySaver())


_graph = build_graph()


async def run_customer_agent(history: list[dict], user_text: str, thread_id: str = "default") -> tuple[str, list[dict], list[dict]]:
    """对外入口：跑图，返回 (最终回复, 思考链, 知识库命中)。

    thread_id 用于 Checkpointer 多轮状态持久化（记忆系统基础）。
    同一 thread_id 跨轮次共享图状态，支持未来 interrupt()/resume（退款 HITL）。
    """
    config = {"configurable": {"thread_id": thread_id}}
    result = await _graph.ainvoke(
        {"messages": [*history, {"role": "user", "content": user_text}]},
        config=config,
    )
    return result.get("final", ""), result.get("thought_chain", []), result.get("kb_hits", [])
