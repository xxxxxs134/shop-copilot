"""意图分流 API（P5-A）：POST /v1/intent。

契约（docs/plan-p5.md §2.1）：
    {"q": "用户问题"} → {"intent": "...", "target": "...", "reason": "...",
                         "entities": {...}, "sentiment": {"label","score","cues"}}

集成协议（§7）：本文件不改 main.py，由整合者统一 include_router(router)。
端点永不 500：classify() 内部已兜底（LLM 失败/坏 JSON → 关键词启发式），
外层再包一层 catch-all，任何未预期异常都降级为 intent="general"
且 entities/sentiment 为空字典。
"""

import logging
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .agent.intent import classify

logger = logging.getLogger("shop-copilot.intent")

router = APIRouter()


class IntentRequest(BaseModel):
    """请求体：{"q": "用户问题"}。"""

    q: str = Field(..., description="用户问题")


class IntentResult(BaseModel):
    """响应体：意图分类 + 路由目标 + 一句话理由 + 实体/情感（供前端 chip 展示）。"""

    intent: str = Field(description="knowledge|data|policy|copywriting|general")
    target: str = Field(description="rag|agent")
    reason: str = Field(description="一句话中文理由")
    entities: dict[str, Any] = Field(
        default_factory=dict,
        description="结构化实体（order_id/product/reason/amount/time_expr/action），仅含识别到的键",
    )
    sentiment: dict[str, Any] = Field(
        default_factory=dict,
        description="情感 {label, score, cues}；异常降级时为空字典",
    )


@router.post("/v1/intent", response_model=IntentResult, summary="意图分类")
async def post_intent(body: IntentRequest) -> IntentResult:
    """分类用户问题并给出路由目标；任何异常都降级为 general，永不 500。"""
    try:
        data = await classify(body.q)
    except Exception as exc:  # 最后防线：classify 理论不抛，此处兜住一切意外
        logger.exception("意图分类端点异常，降级为 general: %s", exc)
        data = {
            "intent": "general",
            "target": "rag",
            "reason": "分类异常，按通用问题处理",
            "entities": {},
            "sentiment": {},
        }
    return IntentResult(**data)
