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
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

from . import router as router_mod
from .llm import chat, chat_json, chat_text
from .tools import REGISTRY

logger = logging.getLogger("shop-copilot.agent.graph")

# 持久化检查点：跨重启保留多轮记忆（data/checkpoints.db，不入库）
_CHECKPOINT_DB = Path(__file__).resolve().parents[3] / "data" / "checkpoints.db"

MAX_STEPS = 5
# 单条工具结果进上下文的字符上限：中文 1 字 ≈ 1-2 token，4000 字 ≈ 4-8k token，
# 足够覆盖订单详情/商品列表；真实大库（如全量订单）超限截断，防撑爆上下文。
TOOL_RESULT_MAX_CHARS = 4000


# ── 状态 ──────────────────────────────────────────────

class AgentState(TypedDict):
    # 输入：历史 + 最新 user 消息（纯 dict，节点只读，不在此图内追加）
    messages: list[dict]
    intent: str            # presales / aftersales / escalation / clarify
    confidence: float
    router_sentiment: dict | None  # 情绪 {label,score,cues}（前端 chip/共情 banner 用）
    draft: str             # specialist 草稿
    evidence: list[dict]   # 工具证据（传给终审，防幻觉）
    kb_hits: list[dict]    # 知识库命中（供 [n] 引用溯源）
    escalation_ticket: dict | None   # 投诉工单
    thought_chain: list[dict]  # 思考链（节点显式累积，不用 reducer——Checkpointer 跨轮不串）
    final: str             # 终审回复（前端取这个）


def _thought(agent: str, input_: str, output: str, detail: str = "") -> dict:
    """统一思考链条目（对齐 RTY798 thought_chain）。"""
    return {"agent": agent, "status": "completed", "input": input_, "output": output, "detail": detail}


def _brief_result(result: str) -> str:
    """工具返回压缩成一行关键字段，供「Agent 处理过程」展示，避免整段 JSON。"""
    try:
        data = json.loads(result)
    except (json.JSONDecodeError, TypeError):
        return result[:80]
    if isinstance(data, dict):
        if "order_id" in data:
            picked = [f"{k}={data[k]}" for k in ("order_id", "status", "carrier", "tracking_no", "amount") if data.get(k) not in (None, "")]
            if picked:
                return ", ".join(picked)[:120]
        orders = data.get("orders")
        if isinstance(orders, list) and orders and isinstance(orders[0], dict):
            first = orders[0]
            picked = [f"{k}={first[k]}" for k in ("order_id", "status", "carrier", "tracking_no", "amount") if first.get(k) not in (None, "")]
            if picked:
                return ", ".join(picked)[:120]
        items = data.get("items")
        if isinstance(items, list) and items and isinstance(items[0], dict):
            first = items[0]
            picked = [f"{k}={first[k]}" for k in ("name", "price", "stock", "sku_id") if first.get(k) not in (None, "")]
            if picked:
                return ", ".join(picked)[:120]
        keys = ("status", "amount", "paid_amount", "after_amount", "needs_confirm", "error", "message")
        picked = [f"{k}={data[k]}" for k in keys if data.get(k) not in (None, "")]
        if picked:
            return ", ".join(picked)[:120]
    return result[:80]


def _tool_trace(evidence: list[dict]) -> str:
    """把本轮工具调用压成「工具(入参) → 关键返回」，让专家步骤能自证干了什么。"""
    if not evidence:
        return "未调用工具"
    parts: list[str] = []
    for item in evidence:
        name = item.get("tool", "")
        args = item.get("args") or {}
        args_text = ", ".join(f"{k}={v}" for k, v in args.items() if v not in (None, ""))
        brief = _brief_result(str(item.get("result", "")))
        parts.append(f"{name}({args_text})" + (f" → {brief}" if brief else ""))
    return "；".join(parts)[:300]


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
- 需要客户提供更多条件（预算、用途、具体款式）时直接追问，此时无需调用工具
- 推荐时给出 1-3 个选项，并说明推荐理由（贴合客户说的需求）
- 用简洁、亲切的中文，不要暴露任何内部技术细节"""

AFTERSALES_SYSTEM = """你是电商店铺的售后客服，接待的是已下单或有售后问题的客户。
职责：查订单/物流、处理退款退货、解答售后政策、安抚情绪。
- 先用工具查订单/政策，再回答，涉及具体数字要准确
- 客户没给订单号时直接追问（此时无需调用工具），拿到订单号后再查
- 客户情绪激动时先安抚一句，再给解决方案
- 涉及退款/改址等操作时，说明需要客户确认后才能执行
- refund_flow 返回的 preview 字段含义：amount=本次退款金额，paid_amount=订单实付金额，after_amount=退款后剩余可退金额；复述时严格按字段名对应，严禁把 after_amount 说成实付金额
- 用简洁、温和的中文，不要暴露任何内部技术细节"""

ESCALATION_PROMPT = """你是电商客服的投诉升级处理专员。客户的问题需要转接人工客服处理。
请分析客户的投诉，生成结构化工单信息。
只输出 JSON：{"ticket_summary": "问题简述（20字内）", "issue_category": "问题类别", "detail": "问题详细描述", "urgency": "high/medium/low", "suggested_action": "建议处理方式"}"""

REVIEW_SYSTEM = """你是客服回复的终审员。根据客服草稿和工具查到的证据，生成最终回复。
规则：
1. 只保留有工具证据支持的信息，草稿里没有证据支撑的猜测一律删除
2. 如果提供了知识库证据（[1][2]...），回答中涉及这些内容时用 [n] 角标标注来源，客户可点开核对
3. 语气统一为亲切、专业的中文客服口吻
4. 草稿中的金额/单号/库存/物流数字必须与工具证据一致；若草稿自相矛盾，以工具证据为准并改正
5. 直接输出最终回复，不要任何前缀或解释"""


# ── 节点 ──────────────────────────────────────────────

async def intent_router(state: AgentState) -> dict:
    """意图路由：售前 / 售后 / 投诉升级 / 澄清；同一次调用顺带产出情绪（前端 chip 单一真相源）。"""
    intent, confidence, sentiment = await router_mod.classify(state["messages"])
    detail = f"置信度 {confidence:.2f}"
    if sentiment:
        detail += f" · 情绪{sentiment['label']}"
    return {
        "intent": intent,
        "confidence": confidence,
        "router_sentiment": sentiment,
        # 每轮重置轮次内状态：否则 Checkpointer 会把上一轮工单/证据带进本轮终审
        "escalation_ticket": None,
        "draft": "",
        "evidence": [],
        "kb_hits": [],
        "thought_chain": [_thought("router", state["messages"][-1].get("content", ""), intent, detail)],
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
            # token 预算：超限截断并标注，防真实大库撑爆上下文
            content = (
                result
                if len(result) <= TOOL_RESULT_MAX_CHARS
                else result[:TOOL_RESULT_MAX_CHARS] + "\n…(结果过长已截断，需要可按条件精查)"
            )
            msgs.append({"role": "tool", "tool_call_id": tc.get("id", ""), "content": content})
    return "", evidence, kb_hits


async def presales_node(state: AgentState) -> dict:
    text, evidence, kb_hits = await _run_react(state["messages"], PRESALES_TOOLS, PRESALES_SYSTEM)
    trace = _tool_trace(evidence)
    return {
        "draft": text,
        "evidence": evidence,
        "kb_hits": kb_hits,
        "thought_chain": [*state.get("thought_chain", []), _thought(
            "presales",
            state["messages"][-1].get("content", ""),
            trace,
            f"调用 {len(evidence)} 次工具：{', '.join(e['tool'] for e in evidence)}" if evidence else "未调用工具",
        )],
    }


async def aftersales_node(state: AgentState) -> dict:
    text, evidence, kb_hits = await _run_react(state["messages"], AFTERSALES_TOOLS, AFTERSALES_SYSTEM)
    trace = _tool_trace(evidence)
    return {
        "draft": text,
        "evidence": evidence,
        "kb_hits": kb_hits,
        "thought_chain": [*state.get("thought_chain", []), _thought(
            "aftersales",
            state["messages"][-1].get("content", ""),
            trace,
            f"调用 {len(evidence)} 次工具：{', '.join(e['tool'] for e in evidence)}" if evidence else "未调用工具",
        )],
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
            "thought_chain": [*state.get("thought_chain", []), _thought("review", "", "", "工单已受理 · 已转人工")],
        }

    evidence = state.get("evidence", [])
    kb_hits = state.get("kb_hits", [])

    # 硬校验①：没调工具时，只放行「追问式」回复（缺订单号就问，不许编事实）
    if not evidence and not kb_hits:
        draft = (state.get("draft") or "").strip()
        _ASK_MARKERS = ("？", "?", "请提供", "请问", "麻烦", "需要您", "请告诉", "方便", "请先")
        is_clarify = bool(draft) and any(k in draft for k in _ASK_MARKERS)
        if is_clarify:
            # 追问不含事实断言，无需终审过滤，直接采用
            return {
                "final": draft,
                "thought_chain": [*state.get("thought_chain", []), _thought("review", "", "", "追问放行（无工具）")],
            }
        # 无证据又不是追问 → 它在凭模型知识编造，强制拒答
        final = "抱歉，这个问题我暂时没有查到确切信息，建议您联系人工客服进一步确认。"
        return {
            "final": final,
            "thought_chain": [*state.get("thought_chain", []), _thought("review", "", "", "拒答（无证据）")],
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
    verdict = f"通过 · 证据 {len(evidence)} 条 · 引用 {len(kb_hits)} 条"
    if kb_hits and "[" not in final:
        verdict += " · 缺引用"
    return {
        "final": final,
        "thought_chain": [*state.get("thought_chain", []), _thought("review", "", "", verdict)],
    }


# ── 路由条件 ─────────────────────────────────────────

def _route(state: AgentState) -> str:
    return state.get("intent", "clarify")


# ── 构建 ─────────────────────────────────────────────

class _AsyncSqliteCheckpointer(SqliteSaver):
    """SqliteSaver 的异步适配层。

    官方 SqliteSaver 的 async 方法直接 NotImplementedError（要求改用 AsyncSqliteSaver），
    而 AsyncSqliteSaver 构造需要运行中的事件循环、无法在模块级同步创建。
    这里把 async 方法经 asyncio.to_thread 代理到同步实现——既能落盘，又不阻塞事件循环。
    """

    async def aget(self, *args, **kwargs):
        return await asyncio.to_thread(super().get, *args, **kwargs)

    async def aget_tuple(self, *args, **kwargs):
        return await asyncio.to_thread(super().get_tuple, *args, **kwargs)

    async def alist(self, *args, **kwargs):
        return await asyncio.to_thread(super().list, *args, **kwargs)

    async def aput(self, *args, **kwargs):
        return await asyncio.to_thread(super().put, *args, **kwargs)

    async def aput_writes(self, *args, **kwargs):
        return await asyncio.to_thread(super().put_writes, *args, **kwargs)


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
    # SqliteSaver 持久化：状态落盘，重启不丢（async 方法经 _AsyncSqliteCheckpointer 适配）
    _CHECKPOINT_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_CHECKPOINT_DB), check_same_thread=False)
    return builder.compile(checkpointer=_AsyncSqliteCheckpointer(conn))


_graph = build_graph()


async def run_customer_agent(history: list[dict], user_text: str, thread_id: str = "default") -> dict:
    """对外入口：跑图，返回 {final, thought_chain, kb_hits, router}。

    thread_id 用于 Checkpointer 多轮状态持久化（记忆系统基础）。
    router 携带意图+情绪，前端 chip 与实际路由同源，杜绝标签打架。
    """
    config = {"configurable": {"thread_id": thread_id}}
    result = await _graph.ainvoke(
        {"messages": [*history, {"role": "user", "content": user_text}]},
        config=config,
    )
    return {
        "final": result.get("final", ""),
        "thought_chain": result.get("thought_chain", []),
        "kb_hits": result.get("kb_hits", []),
        "router": {
            "intent": result.get("intent", ""),
            "confidence": result.get("confidence", 0.0),
            "sentiment": result.get("router_sentiment"),
        },
    }
