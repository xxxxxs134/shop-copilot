# -*- coding: utf-8 -*-
"""退款操作 API（P6 强化）：POST /v1/refund/validate + /v1/refund/execute。

敏感操作不走 AI，前端直接调用两段式接口：
    POST /v1/refund/validate  {order_id, amount} → {ok, token, preview, violations}
    POST /v1/refund/execute   {order_id, token}  → {ok, receipt, idempotent, message}
"""

import logging

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .agent.data_provider import get_provider

logger = logging.getLogger("shop-copilot.refund")

router = APIRouter()


class RefundValidateRequest(BaseModel):
    order_id: str = Field(..., description="订单号")
    amount: float = Field(..., description="退款金额")


class RefundExecuteRequest(BaseModel):
    order_id: str = Field(..., description="订单号")
    token: str = Field(..., description="确认令牌（validate 返回）")


@router.post("/v1/refund/validate", summary="退款校验（第一段）")
async def refund_validate(body: RefundValidateRequest) -> dict:
    try:
        return get_provider().validate_refund(body.order_id, body.amount)
    except Exception as exc:
        logger.exception("退款校验异常: %s", exc)
        return {"ok": False, "violations": ["系统异常，请稍后重试"]}


@router.post("/v1/refund/execute", summary="退款执行（第二段，凭令牌）")
async def refund_execute(body: RefundExecuteRequest) -> dict:
    try:
        return get_provider().execute_refund(body.order_id, body.token)
    except Exception as exc:
        logger.exception("退款执行异常: %s", exc)
        return {"ok": False, "violations": ["系统异常，请稍后重试"]}
