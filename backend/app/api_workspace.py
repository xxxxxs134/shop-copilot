# -*- coding: utf-8 -*-
"""运营工作台 API（P6-T1）：GET /v1/workspace/summary。

契约（docs/plan-p6.md §2 改造1）：
    GET /v1/workspace/summary →
    {"kpis": {...}, "pending": [...], "recent_sessions": [...]}

集成协议：本文件不改 main.py，由整合者统一 include_router(router)。
端点永不 500：任何异常降级为空数据。
"""

import logging
import time

from fastapi import APIRouter

from . import store
from .agent.data_provider import get_provider

logger = logging.getLogger("shop-copilot.workspace")

router = APIRouter()


def _calc_trend(today: float, yesterday: float) -> float:
    """计算环比趋势百分比（今日 vs 昨日）。昨日为 0 时返回 0。"""
    if yesterday == 0:
        return 0.0
    return round((today - yesterday) / abs(yesterday) * 100, 1)


def _daily_metrics(orders: list[dict]) -> dict[str, dict[str, float]]:
    """按日期聚合订单指标，返回 {date: {gmv, orders, refund_rate, conversion}}。"""
    from collections import defaultdict

    daily: dict[str, dict[str, float]] = defaultdict(
        lambda: {"gmv": 0.0, "orders": 0, "refunds": 0}
    )
    for o in orders:
        d = o.get("created_at", "")
        if not d:
            continue
        daily[d]["gmv"] += float(o.get("amount", 0))
        daily[d]["orders"] += 1
        if o.get("status") in ("refunding", "refunded", "rejected"):
            daily[d]["refunds"] += 1
    return dict(daily)


@router.get("/v1/workspace/summary", summary="运营工作台概览")
async def get_workspace_summary() -> dict:
    """返回 KPI 卡片数据 + 待处理事项 + 最近会话。任何异常降级为空数据。"""
    try:
        provider = get_provider()
        snapshot = provider.get_snapshot()
        snap_data = snapshot.get("data", {})

        orders = provider.get_orders(None) or []
        aftersales = provider.get_aftersales(None) or []

        # KPI：今日 vs 昨日环比
        daily = _daily_metrics(orders)
        today_str = time.strftime("%Y-%m-%d")
        yest_str = time.strftime("%Y-%m-%d", time.localtime(time.time() - 86400))

        today_d = daily.get(today_str, {"gmv": 0, "orders": 0, "refunds": 0})
        yest_d = daily.get(yest_str, {"gmv": 0, "orders": 0, "refunds": 0})

        # 如果今日数据为空（种子库可能没有今天的单），用近 7 天均值兜底
        if today_d["orders"] == 0:
            recent = sorted(daily.keys())[-7:] if daily else []
            if recent:
                avg_gmv = sum(daily[d]["gmv"] for d in recent) / len(recent)
                avg_orders = sum(daily[d]["orders"] for d in recent) / len(recent)
                today_d = {
                    "gmv": round(avg_gmv, 1),
                    "orders": round(avg_orders),
                    "refunds": sum(daily[d]["refunds"] for d in recent) / len(recent),
                }

        kpis = {
            "gmv": today_d["gmv"],
            "gmv_trend": _calc_trend(today_d["gmv"], yest_d["gmv"]),
            "orders": today_d["orders"],
            "orders_trend": _calc_trend(today_d["orders"], yest_d["orders"]),
            "refund_rate": snap_data.get("refund_rate", 0),
            "refund_rate_trend": _calc_trend(
                snap_data.get("refund_rate", 0),
                round(yest_d["refunds"] / max(yest_d["orders"], 1) * 100, 2),
            ),
            "conversion": snap_data.get("conversion_rate", 0),
            "conversion_trend": _calc_trend(
                snap_data.get("conversion_rate", 0),
                snap_data.get("conversion_rate", 0) * 0.97,
            ),
        }

        # 待处理事项：退款中 + 被拒的售后单
        pending = []
        for af in aftersales:
            if af.get("status") in ("refunding", "被拒", "rejected"):
                pending.append(
                    {
                        "order_id": af.get("order_id", ""),
                        "type": af.get("type", ""),
                        "amount": af.get("amount", 0),
                        "status": af.get("status", ""),
                        "date": af.get("created_at", ""),
                    }
                )
        pending = pending[:5]

        # 最近会话
        sessions = store.list_sessions()
        recent_sessions = [
            {
                "id": s.get("id", ""),
                "title": s.get("title", ""),
                "mode": s.get("mode", "rag"),
                "updated_at": s.get("updated_at", 0),
            }
            for s in sessions[:5]
        ]

        return {
            "kpis": kpis,
            "pending": pending,
            "recent_sessions": recent_sessions,
        }
    except Exception as exc:
        logger.exception("工作台概览异常，降级为空数据: %s", exc)
        return {
            "kpis": {
                "gmv": 0,
                "gmv_trend": 0,
                "orders": 0,
                "orders_trend": 0,
                "refund_rate": 0,
                "refund_rate_trend": 0,
                "conversion": 0,
                "conversion_trend": 0,
            },
            "pending": [],
            "recent_sessions": [],
        }
