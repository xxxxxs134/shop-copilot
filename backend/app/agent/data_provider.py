"""数据源 Provider 插件化（对标 RTY798/ai-customer-service-agent 三步接入法）。

契约（docs/plan-p4.md §3.3）：
- DataProvider.get_snapshot(date=None) -> dict  — data_query 工具的唯一依赖
- 默认 SqliteStoreProvider：对 data/store.db 做真实 SQL 查询（30 天日粒度数据）
- MockProvider：原样例数据兜底（DATA_PROVIDER=mock 或索引缺失时自动回退）
- 接入真实店铺 = 实现同一 Protocol，再改 .env 一行 DATA_PROVIDER

切换：backend/.env 中 DATA_PROVIDER=sqlite|mock（默认 sqlite）
"""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Protocol

STORE_DB = Path(__file__).resolve().parents[3] / "data" / "store.db"


class DataProvider(Protocol):
    """data_query 的唯一契约：返回快照 dict。"""

    name: str

    def get_snapshot(self, date: str | None = None) -> dict: ...


# ────────────────────────────── Mock（兜底） ──────────────────────────────

_MOCK_DATA = {
    "gmv": 12840.50,
    "orders": 156,
    "visitors": 3820,
    "conversion_rate": 4.08,
    "avg_order_value": 82.31,
    "refund_rate": 1.92,
    "top_products": [
        {"name": "纯棉基础款T恤", "sales": 42, "gmv": 3360},
        {"name": "便携式充电宝", "sales": 28, "gmv": 2800},
        {"name": "桌面收纳盒", "sales": 35, "gmv": 1750},
    ],
    "traffic_sources": {"search": 52, "recommend": 28, "direct": 12, "paid": 8},
}


class MockProvider:
    name = "mock"

    def get_snapshot(self, date: str | None = None) -> dict:
        return {
            "date": date or "2026-10-23",
            "source": "mock",
            "data": _MOCK_DATA,
            "note": "样例数据（backend/.env 设 DATA_PROVIDER=sqlite 可切换真实 SQL 查询）",
        }


# ────────────────────────────── SQLite（默认） ──────────────────────────────

class SqliteStoreProvider:
    name = "sqlite"

    def __init__(self, db_path: Path = STORE_DB):
        self.db_path = db_path

    def get_snapshot(self, date: str | None = None) -> dict:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            if date is None:
                row = conn.execute("SELECT MAX(date) AS d FROM daily_metrics").fetchone()
                if not row or not row["d"]:
                    raise RuntimeError(f"store.db 无数据（先执行 python -m backend.app.agent.seed_store）")
                date = row["d"]

            daily = conn.execute(
                "SELECT gmv, orders, visitors, conversion_rate, avg_order_value, refund_rate"
                " FROM daily_metrics WHERE date = ?",
                (date,),
            ).fetchone()
            if not daily:
                raise RuntimeError(f"store.db 无 {date} 的数据（可用日期上限见 MAX(date)）")

            products = [
                {"name": r["name"], "sales": r["sales"], "gmv": r["gmv"]}
                for r in conn.execute(
                    "SELECT name, sales, gmv FROM product_sales WHERE date = ?"
                    " ORDER BY sales DESC LIMIT 3",
                    (date,),
                ).fetchall()
            ]
            traffic_rows = conn.execute(
                "SELECT source, pct FROM traffic_sources WHERE date = ?", (date,)
            ).fetchall()
            traffic = {r["source"]: r["pct"] for r in traffic_rows}

            return {
                "date": date,
                "source": "sqlite",
                "data": {
                    "gmv": daily["gmv"],
                    "orders": daily["orders"],
                    "visitors": daily["visitors"],
                    "conversion_rate": daily["conversion_rate"],
                    "avg_order_value": daily["avg_order_value"],
                    "refund_rate": daily["refund_rate"],
                    "top_products": products,
                    "traffic_sources": traffic,
                },
            }
        finally:
            conn.close()


# ────────────────────────────── 工厂（进程级单例） ──────────────────────────────

_provider: DataProvider | None = None


def get_provider() -> DataProvider:
    """按 DATA_PROVIDER 环境变量选择；sqlite 库缺失时回退 mock（与 RAG 索引缺失同策略）。"""
    global _provider
    if _provider is not None:
        return _provider
    kind = os.getenv("DATA_PROVIDER", "sqlite").lower()
    if kind == "sqlite" and STORE_DB.exists():
        _provider = SqliteStoreProvider()
    else:
        if kind == "sqlite":
            print(f"[data] store.db 缺失，回退 MockProvider（python -m backend.app.agent.seed_store 可生成）")
        _provider = MockProvider()
    return _provider


def snapshot_json(date: str | None = None) -> str:
    """给 data_query 工具用：快照 → JSON 字符串。"""
    try:
        snap = get_provider().get_snapshot(date)
    except Exception as exc:  # noqa: BLE001 — 工具层兜底，不让 Agent 循环崩
        return json.dumps({"error": f"数据源查询失败: {exc}"}, ensure_ascii=False)
    return json.dumps(snap, ensure_ascii=False)
