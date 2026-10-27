# -*- coding: utf-8 -*-
"""人机协同增强 API（human-in-the-loop）：POST /v1/escalate + GET /v1/escalation/stats。

Agent 会话升级人工坐席时调用，毫秒级返回上下文摘要与坐席辅助建议
（纯启发式分析消息内容，不调用 LLM）：
    POST /v1/escalate         {session_id, reason, messages} → {summary, suggestions, scripts}
    GET  /v1/escalation/stats                              → {total, pending, resolved, avg_resolution_minutes}
"""

import logging
import re
from dataclasses import dataclass

from fastapi import APIRouter
from pydantic import BaseModel, Field

logger = logging.getLogger("shop-copilot.escalation")

router = APIRouter()

# ────────────────────────────── 启发式规则表 ──────────────────────────────

# 业务关键词（场景判定）与情绪关键词（摘要修饰），按升级紧迫度排序
_SCENE_KEYWORDS = ("退款", "退货", "物流", "地址")
_EMOTION_KEYWORDS = ("投诉",)

_TOPIC_PHRASE = {
    "投诉": "投诉与售后问题",
    "退款": "退款进度",
    "退货": "退货退款进度",
    "物流": "物流配送进度",
    "地址": "收货地址变更",
    "通用": "业务问题",
}

_SCENE_SUGGESTIONS: dict[str, list[tuple[str, str]]] = {
    "退款": [
        ("🔍", "查询售后单的具体处理节点和预计完成时间"),
        ("💬", "安抚客户情绪，说明退款处理的标准时效"),
        ("📞", "如客户仍不满意，可升级至主管处理"),
    ],
    "退货": [
        ("🔍", "核实退货物流签收状态与质检进度"),
        ("📦", "确认退货商品是否已入库，推进退款触发"),
        ("💬", "向客户说明退货验收与退款联动的处理流程"),
    ],
    "投诉": [
        ("💬", "优先安抚客户情绪，避免矛盾升级"),
        ("🔍", "核实客户投诉的具体诉求与问题节点"),
        ("📞", "同步主管并记录工单，给出明确处理时限"),
    ],
    "物流": [
        ("🔍", "查询物流轨迹与最近一次揽收/中转记录"),
        ("📦", "如包裹异常，协调快递催件或发起补发"),
        ("💬", "向客户同步配送时效与当前节点"),
    ],
    "地址": [
        ("🔍", "核实订单当前履约状态，确认能否改址"),
        ("📦", "可改址则联系仓库/快递修改收货信息"),
        ("💬", "告知客户地址修改规则与截止时间"),
    ],
    "通用": [
        ("🔍", "复盘会话上下文，明确客户核心诉求"),
        ("💬", "与客户确认问题现状与期望的处理结果"),
        ("📞", "必要时升级至主管或转交专项处理"),
    ],
}

_SCENE_SCRIPTS: dict[str, list[tuple[str, str]]] = {
    "退款": [
        ("安抚客户", "非常抱歉给您带来不好的体验，我已经帮您查询到退款正在处理中，预计1-2个工作日内到账。"),
        ("解释时效", "退款到账时间取决于银行处理速度，一般1-3个工作日，请您耐心等待。"),
    ],
    "退货": [
        ("说明流程", "您的退货我们已经签收，质检通过后会立即触发退款，整体流程一般需要1-3个工作日。"),
        ("安抚客户", "给您带来不便非常抱歉，我会持续跟进退货验收进度，有结果第一时间同步您。"),
    ],
    "投诉": [
        ("诚恳致歉", "非常抱歉这次没有让您满意，您的问题我已经记录并同步主管，我们会在24小时内给您明确的处理方案。"),
        ("承诺跟进", "请您放心，我会作为您的专属跟进人持续跟进处理进度，随时向您反馈。"),
    ],
    "物流": [
        ("同步进度", "我已经帮您查到包裹的最新物流节点，目前运输正常，预计1-2天内送达。"),
        ("异常处理", "很抱歉包裹出现延误，我这边会立即联系快递催件，并持续为您跟进最新轨迹。"),
    ],
    "地址": [
        ("改址成功", "您的收货地址已经为您修改成功，后续将按新地址配送，请您留意物流信息。"),
        ("改址失败", "很抱歉，由于订单已出库无法修改地址，您可以拒收后重新下单，我们协助您处理。"),
    ],
    "通用": [
        ("承接诉求", "您好，您的问题我已经了解，正在为您加急处理，稍后为您同步处理结果。"),
        ("承诺跟进", "给您带来不便非常抱歉，我们会尽快给您明确答复，请您保持联系方式畅通。"),
    ],
}

_ORDER_RE = re.compile(r"SO\d{6,}", re.IGNORECASE)
_TICKET_RE = re.compile(r"售后单\s*#?\s*(\d+)")

# demo 级内存计数器（进程重启清零）：escalate 时累加 total/pending，
# resolved/avg 由人工处理完成后的回写流程更新（暂未接入端点）。
_stats: dict[str, float] = {
    "total": 0,
    "pending": 0,
    "resolved": 0,
    "avg_resolution_minutes": 0.0,
}


# ────────────────────────────── 请求模型 ──────────────────────────────

class EscalateMessage(BaseModel):
    role: str = Field("user", description="消息角色：user / assistant")
    content: str | list | None = Field(None, description="消息文本或 parts 列表")


class EscalateRequest(BaseModel):
    session_id: str = Field("", description="会话 ID")
    reason: str = Field("", description="升级人工的原因")
    messages: list[EscalateMessage] = Field(default_factory=list, description="会话消息")


@dataclass(frozen=True, slots=True)
class _Analysis:
    """消息启发式分析结果（内部值对象）。"""

    scene: str
    keywords: tuple[str, ...]
    order_id: str | None
    ticket_id: str | None
    user_count: int
    agent_count: int


# ────────────────────────────── 启发式分析 ──────────────────────────────

def _msg_text(content: object) -> str:
    """提取消息纯文本（兼容 str 与 parts 两种 content 形态）。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            str(p.get("text", ""))
            for p in content
            if isinstance(p, dict) and p.get("type") == "text"
        )
    return ""


def _analyze(messages: list[EscalateMessage]) -> _Analysis:
    texts = [_msg_text(m.content) for m in messages]
    joined = "\n".join(t for t in texts if t)

    keywords = tuple(k for k in _SCENE_KEYWORDS if k in joined)
    has_complaint = any(k in joined for k in _EMOTION_KEYWORDS)
    if keywords:
        scene = keywords[0]
    elif has_complaint:
        scene = "投诉"
    else:
        scene = "通用"
    order_match = _ORDER_RE.search(joined)
    ticket_match = _TICKET_RE.search(joined)
    return _Analysis(
        scene=scene,
        keywords=keywords + (("投诉",) if has_complaint else ()),
        order_id=order_match.group(0).upper() if order_match else None,
        ticket_id=ticket_match.group(1) if ticket_match else None,
        user_count=sum(1 for m in messages if m.role == "user"),
        agent_count=sum(1 for m in messages if m.role in ("assistant", "agent")),
    )


def _build_summary(analysis: _Analysis, reason: str, message_count: int) -> str:
    topic = _TOPIC_PHRASE.get(analysis.scene, _TOPIC_PHRASE["通用"])
    if message_count == 0:
        summary = "暂无会话消息，无法还原对话上下文"
    else:
        subject = f"订单 {analysis.order_id} 的{topic}" if analysis.order_id else topic
        summary = (
            f"客户咨询{subject}，共 {message_count} 条消息"
            f"（用户 {analysis.user_count} 条 / Agent {analysis.agent_count} 条）"
        )
        if analysis.ticket_id:
            summary += f"，涉及售后单 #{analysis.ticket_id}"
        if "投诉" in analysis.keywords and analysis.scene != "投诉":
            summary += "，客户表达了投诉意向"
    if reason.strip():
        summary += f"。升级原因：{reason.strip()}"
    else:
        summary += "。"
    return summary


def _build_payload(analysis: _Analysis, reason: str, message_count: int) -> dict:
    suggestions = [
        {"icon": icon, "text": text}
        for icon, text in _SCENE_SUGGESTIONS.get(analysis.scene, _SCENE_SUGGESTIONS["通用"])
    ]
    scripts = [
        {"scenario": scenario, "text": text}
        for scenario, text in _SCENE_SCRIPTS.get(analysis.scene, _SCENE_SCRIPTS["通用"])
    ]
    return {
        "summary": _build_summary(analysis, reason, message_count),
        "suggestions": suggestions,
        "scripts": scripts,
    }


def _fallback_payload() -> dict:
    """任何异常下的兜底响应（约束：接口永不 500）。"""
    return {
        "summary": "升级上下文生成异常，已返回默认摘要，请人工直接查看完整会话记录。",
        "suggestions": [
            {"icon": "🔍", "text": "人工浏览完整会话记录，确认客户核心诉求"},
            {"icon": "💬", "text": "主动联系客户，说明已转人工跟进处理"},
        ],
        "scripts": [
            {"scenario": "承接诉求", "text": "您好，您的问题已转交人工客服跟进，我们会尽快为您处理并同步结果。"},
        ],
    }


# ────────────────────────────── 端点 ──────────────────────────────

@router.post("/v1/escalate", summary="人机协同：生成升级上下文摘要与坐席建议")
async def escalate(body: EscalateRequest) -> dict:
    try:
        analysis = _analyze(body.messages)
        result = _build_payload(analysis, body.reason, len(body.messages))
        _stats["total"] += 1
        _stats["pending"] += 1
        return result
    except Exception as exc:
        logger.exception("升级上下文生成异常: %s", exc)
        return _fallback_payload()


@router.get("/v1/escalation/stats", summary="升级工单统计（demo 级内存计数）")
async def escalation_stats() -> dict:
    try:
        return {
            "total": int(_stats["total"]),
            "pending": int(_stats["pending"]),
            "resolved": int(_stats["resolved"]),
            "avg_resolution_minutes": float(_stats["avg_resolution_minutes"]),
        }
    except Exception as exc:
        logger.exception("升级统计读取异常: %s", exc)
        return {"total": 0, "pending": 0, "resolved": 0, "avg_resolution_minutes": 0.0}
