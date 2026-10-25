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
        orders = get_provider().get_orders(order_id) or []
        if not orders:
            raise HTTPException(status_code=404, detail="订单不存在")
        o = orders[0]
        item = (o.get("items") or [{}])[0]

        status = o.get("status", "")
        date = o.get("created_at", "")

        timeline = [{"date": date, "label": "下单", "status": "done"}]
        if status != "unpaid":
            timeline.append({"date": date, "label": "支付", "status": "done"})
        if status in ("shipped", "received", "refunding", "refunded", "rejected"):
            timeline.append({"date": date, "label": "发货", "status": "done"})
        if status in ("refunding",):
            timeline.append({"date": date, "label": "退款中", "status": "current"})
        elif status in ("refunded",):
            timeline.append({"date": date, "label": "已退款", "status": "done"})
        elif status in ("rejected",):
            timeline.append({"date": date, "label": "退款被拒", "status": "done"})
        elif status == "received":
            timeline.append({"date": date, "label": "确认收货", "status": "done"})

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
        raise HTTPException(status_code=500, detail="查询失败")
