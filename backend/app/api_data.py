# -*- coding: utf-8 -*-
"""业务数据只读 API（P6-T4）：GET /v1/data/*。

契约（docs/plan-p6.md §2 改造2）：
    GET /v1/data/orders       → 订单列表
    GET /v1/data/products     → 商品列表
    GET /v1/data/aftersales   → 售后单列表
    GET /v1/data/order/{id}   → 单笔订单详情（含时间线）
"""

import logging

from fastapi import APIRouter, HTTPException

from .agent.data_provider import get_provider

logger = logging.getLogger("shop-copilot.data")

router = APIRouter()


@router.get("/v1/data/orders", summary="订单列表")
async def get_orders() -> list[dict]:
    try:
        orders = get_provider().get_orders(None) or []
        return [
            {
                "order_id": o.get("order_id", ""),
                "product": (o.get("items") or [{}])[0].get("name", ""),
                "buyer": o.get("buyer", ""),
                "amount": o.get("amount", 0),
                "status": o.get("status", ""),
                "date": o.get("created_at", ""),
            }
            for o in orders
        ]
    except Exception as exc:
        logger.exception("订单列表异常: %s", exc)
        return []


@router.get("/v1/data/products", summary="商品列表")
async def get_products() -> list[dict]:
    try:
        prods = get_provider().get_products(None) or []
        return [
            {
                "sku": p.get("sku", ""),
                "name": p.get("name", ""),
                "price": p.get("price", 0),
                "stock": p.get("stock", 0),
                "category": p.get("category", ""),
            }
            for p in prods
        ]
    except Exception as exc:
        logger.exception("商品列表异常: %s", exc)
        return []


@router.get("/v1/data/aftersales", summary="售后单列表")
async def get_aftersales() -> list[dict]:
    try:
        afs = get_provider().get_aftersales(None) or []
        return [
            {
                "id": a.get("id", 0),
                "order_id": a.get("order_id", ""),
                "type": a.get("type", ""),
                "amount": a.get("amount", 0),
                "status": a.get("status", ""),
                "date": a.get("created_at", ""),
            }
            for a in afs
        ]
    except Exception as exc:
        logger.exception("售后单列表异常: %s", exc)
        return []


@router.get("/v1/data/order/{order_id}", summary="订单详情")
async def get_order_detail(order_id: str) -> dict:
    try:
        provider = get_provider()
        orders = provider.get_orders(order_id) or []
        if not orders:
            raise HTTPException(status_code=404, detail="订单不存在")
        o = orders[0]
        item = (o.get("items") or [{}])[0]

        status = o.get("status", "")
        date = o.get("created_at", "")
        amount = float(o.get("amount") or 0)

        timeline = [
            {"date": date, "label": "下单", "status": "done", "detail": "订单已创建"},
        ]
        if status != "unpaid":
            timeline.append(
                {"date": date, "label": "支付", "status": "done", "detail": f"已支付 ¥{amount:.2f}"}
            )
        if status in ("shipped", "received", "refunding", "refunded", "rejected"):
            carrier = str(o.get("carrier") or "")
            tracking = str(o.get("tracking_no") or "")
            if carrier and tracking:
                ship_detail = f"{carrier} · {tracking}"
            elif carrier:
                ship_detail = carrier
            elif status in ("shipped", "received"):
                ship_detail = "已交付承运商"
            else:
                ship_detail = "订单已进入售后流程"
            timeline.append(
                {"date": date, "label": "发货", "status": "done", "detail": ship_detail}
            )
        if status == "received":
            timeline.append(
                {"date": date, "label": "确认收货", "status": "done", "detail": "买家已确认收货"}
            )

        aftersales = sorted(
            provider.get_aftersales(order_id) or [],
            key=lambda a: str(a.get("created_at", "")),
        )
        for af in aftersales:
            af_status = str(af.get("status") or "")
            af_type = str(af.get("type") or "售后")
            af_amount = float(af.get("amount") or 0)
            if af_status == "退款中":
                label, detail, tone = "退款中", f"{af_type} ¥{af_amount:.2f}，等待商家处理", "current"
            elif af_status == "被拒":
                label, detail, tone = "退款被拒", f"{af_type} ¥{af_amount:.2f}，申请未通过", "done"
            elif af_status == "已完成":
                label, detail, tone = "退款完成", f"{af_type} ¥{af_amount:.2f}，退款已完成", "done"
            else:
                continue
            timeline.append(
                {"date": af.get("created_at", ""), "label": label, "status": tone, "detail": detail}
            )

        return {
            "order_id": o.get("order_id", ""),
            "product": item.get("name", ""),
            "buyer": o.get("buyer", ""),
            "amount": o.get("amount", 0),
            "status": status,
            "date": date,
            "timeline": timeline,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("订单详情异常: %s", exc)
        raise HTTPException(status_code=500, detail="订单数据查询失败，请稍后重试")
