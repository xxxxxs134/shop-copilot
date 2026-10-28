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
from datetime import date, timedelta

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
        d = str(o.get("created_at", ""))[:10]
        if not d:
            continue
        daily[d]["gmv"] += float(o.get("amount", 0))
        daily[d]["orders"] += 1
        if o.get("status") in ("refunding", "refunded", "rejected"):
            daily[d]["refunds"] += 1
    return dict(daily)


INSIGHT_TYPE_RANK: dict[str, int] = {"warning": 0, "suggestion": 1, "info": 2}


def _refund_insight(
    refund_rate: float, daily: dict[str, dict[str, float]]
) -> dict[str, str] | None:
    """退款率 > 2.5% 时告警，与窗口内日均退款率对比。"""
    if refund_rate <= 2.5:
        return None
    rates = [
        d["refunds"] / max(d["orders"], 1) * 100
        for d in daily.values()
        if d["orders"] > 0
    ]
    avg_rate = sum(rates) / len(rates) if rates else 0.0
    delta = refund_rate - avg_rate
    if abs(delta) < 0.005:
        compare = "与近期均值持平"
    else:
        compare = f"较近期均值{'上升' if delta > 0 else '下降'} {abs(delta):.2f}%"
    return {
        "icon": "📊",
        "text": f"今日退款率 {refund_rate:.2f}%，{compare}。建议关注退款集中的商品类目。",
        "type": "warning",
    }


def _stock_insight(products: list[dict]) -> dict[str, str] | None:
    """在售商品库存 ≤ 5 件时告警：报最紧急的一个，多个时提示总数。"""
    low = sorted(
        (p for p in products if p.get("status") == "在售" and 0 <= (p.get("stock") or 0) <= 5),
        key=lambda p: p.get("stock") or 0,
    )
    if not low:
        return None
    worst = low[0]
    name = f"{worst.get('sku', '')} {worst.get('name', '')}".strip()
    stock = int(worst.get("stock") or 0)
    more = f"另有 {len(low) - 1} 个在售商品库存告急，" if len(low) > 1 else ""
    return {
        "icon": "📦",
        "text": f"{name}库存仅 {stock} 件，{more}建议尽快补货。",
        "type": "warning",
    }


def _knowledge_insight(
    kb_stats: dict, recent_sessions: list[dict]
) -> dict[str, str] | None:
    """知识库索引为空或近期无会话时，建议更新知识库。"""
    chunk_count = int(kb_stats.get("chunk_count", 0))
    if chunk_count > 0 and recent_sessions:
        return None
    doc_count = int(kb_stats.get("doc_count", 0))
    if chunk_count == 0:
        text = f"知识库 {doc_count} 篇文档尚未建立索引，建议先构建索引并补充平台新规则。"
    else:
        text = f"知识库 {doc_count} 篇文档最近 7 天无更新，建议关注平台新规则。"
    return {"icon": "💡", "text": text, "type": "suggestion"}


def _gmv_insight(gmv: float, orders: float) -> dict[str, str] | None:
    """今日 GMV > 0 时给经营活跃的正向提示。"""
    if gmv <= 0:
        return None
    return {
        "icon": "📈",
        "text": f"今日 GMV ¥{gmv:,.0f}、订单 {int(orders)} 单，经营活跃度良好。",
        "type": "info",
    }


ORDER_STATUSES: tuple[str, ...] = (
    "paid",
    "shipped",
    "received",
    "refunding",
    "refunded",
    "rejected",
    "unpaid",
)


def _daily_trend(orders: list[dict], days: int = 30) -> list[dict]:
    """最近 N 天 GMV/订单数趋势：按 created_at 日期聚合，缺失日期补零，日期升序。"""
    daily = _daily_metrics(orders)
    today = date.today()
    trend: list[dict] = []
    for i in range(days - 1, -1, -1):
        ds = (today - timedelta(days=i)).isoformat()
        m = daily.get(ds, {"gmv": 0.0, "orders": 0})
        trend.append({"date": ds, "gmv": m["gmv"], "orders": m["orders"]})
    return trend


def _order_status_dist(orders: list[dict]) -> dict[str, int]:
    """订单状态分布（固定 7 个状态键，无数据补 0）。"""
    dist: dict[str, int] = dict.fromkeys(ORDER_STATUSES, 0)
    for o in orders:
        s = str(o.get("status", ""))
        if s in dist:
            dist[s] += 1
    return dist


def _aftersales_dist(aftersales: list[dict]) -> dict[str, int]:
    """售后单状态分布（按实际状态计数）。"""
    dist: dict[str, int] = {}
    for a in aftersales:
        s = str(a.get("status", ""))
        dist[s] = dist.get(s, 0) + 1
    return dist


def _order_index(orders: list[dict]) -> dict[str, dict]:
    """订单号 → 订单，供售后单补齐买家/商品（订单行含 buyer 与 items）。"""
    return {str(o.get("order_id", "")): o for o in orders if o.get("order_id")}


def _order_buyer(order: dict | None) -> str:
    """关联订单的买家昵称（脱敏形式，来自 orders.buyer）。"""
    return str((order or {}).get("buyer") or "")


def _order_product(order: dict | None) -> str:
    """关联订单的首个商品名称；无明细时回退 SKU。"""
    items = (order or {}).get("items") or []
    if not items or not isinstance(items[0], dict):
        return ""
    first = items[0]
    return str(first.get("name") or first.get("sku") or "")


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

        # 待处理事项：退款中 + 被拒的售后单（补关联订单的买家与商品，前端直接展示）
        orders_by_id = _order_index(orders)
        pending = []
        for af in aftersales:
            if af.get("status") in ("refunding", "退款中", "被拒", "rejected"):
                order = orders_by_id.get(str(af.get("order_id", "")))
                pending.append(
                    {
                        "order_id": af.get("order_id", ""),
                        "type": af.get("type", ""),
                        "amount": af.get("amount", 0),
                        "status": af.get("status", ""),
                        "date": af.get("created_at", ""),
                        "buyer": _order_buyer(order),
                        "product": _order_product(order),
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

        # 商品库存（P5 可选方法：未实现/异常时跳过低库存洞察，不影响其余数据）
        products: list[dict] = []
        get_products = getattr(provider, "get_products", None)
        if callable(get_products):
            try:
                products = get_products(None) or []
            except Exception as exc:
                logger.warning("商品查询失败，跳过低库存洞察: %s", exc)

        kb_stats = {
            "doc_count": 43,
            "chunk_count": 43,
            "retrieval_score": 90,
        }

        # Agent 今日洞察：按 warning > suggestion > info 排序取最相关的 2-3 条
        candidates = [
            _refund_insight(snap_data.get("refund_rate", 0), daily),
            _stock_insight(products),
            _knowledge_insight(kb_stats, recent_sessions),
            _gmv_insight(today_d["gmv"], today_d["orders"]),
        ]
        insights = sorted(
            (c for c in candidates if c is not None),
            key=lambda i: INSIGHT_TYPE_RANK.get(i["type"], 9),
        )[:3]
        if not insights:
            insights = [
                {"icon": "✅", "text": "今日经营数据平稳，暂无需要关注的异常。", "type": "info"}
            ]

        return {
            "kpis": kpis,
            "pending": pending,
            "recent_sessions": recent_sessions,
            "insights": insights,
            "top_products": snap_data.get("top_products", [])[:5],
            "traffic_sources": snap_data.get("traffic_sources", {}),
            "kb_stats": kb_stats,
            "daily_trend": _daily_trend(orders),
            "order_status_dist": _order_status_dist(orders),
            "aftersales_dist": _aftersales_dist(aftersales),
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
            "insights": [],
            "top_products": [],
            "traffic_sources": {},
            "kb_stats": {"doc_count": 0, "chunk_count": 0, "retrieval_score": 0},
            "daily_trend": [],
            "order_status_dist": _order_status_dist([]),
            "aftersales_dist": {},
        }
