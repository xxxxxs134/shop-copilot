"""生成 30 天店铺经营种子数据 → data/store.db（幂等：整表重建）。

用法（项目根目录）：
  python -m backend.app.agent.seed_store

数据特征（fixed seed，每次生成一致）：
- 週末（六/日）销量 ×1.25，工作日基准
- 6 个商品、日粒度 metrics / product_sales / traffic_sources 三表
- gmv 与商品销量联动，转化率 3.4%~4.8%，退款率 1.2%~3.2%
"""

from __future__ import annotations

import random
import sqlite3
from datetime import date, timedelta
from pathlib import Path

STORE_DB = Path(__file__).resolve().parents[3] / "data" / "store.db"

PRODUCTS = [
    ("纯棉基础款T恤", 79.9),
    ("便携式充电宝", 99.0),
    ("桌面收纳盒", 49.9),
    ("无线蓝牙耳机", 199.0),
    ("儿童保温杯", 69.0),
    ("厨房置物架", 129.0),
]

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS daily_metrics (
        date TEXT PRIMARY KEY,
        gmv REAL NOT NULL,
        orders INTEGER NOT NULL,
        visitors INTEGER NOT NULL,
        conversion_rate REAL NOT NULL,
        avg_order_value REAL NOT NULL,
        refund_rate REAL NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS product_sales (
        date TEXT NOT NULL,
        name TEXT NOT NULL,
        sales INTEGER NOT NULL,
        gmv REAL NOT NULL,
        PRIMARY KEY (date, name)
    )""",
    """CREATE TABLE IF NOT EXISTS traffic_sources (
        date TEXT NOT NULL,
        source TEXT NOT NULL,
        pct REAL NOT NULL,
        PRIMARY KEY (date, source)
    )""",
]


def build(end: date = date.today(), days: int = 30, seed: int = 42) -> None:
    rng = random.Random(seed)
    STORE_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(STORE_DB)
    try:
        for stmt in SCHEMA:
            conn.execute(stmt)
        # 幂等重建
        for tbl in ("traffic_sources", "product_sales", "daily_metrics"):
            conn.execute(f"DELETE FROM {tbl}")

        for i in range(days - 1, -1, -1):
            d = end - timedelta(days=i)
            ds = d.isoformat()
            weekend = 1.25 if d.weekday() >= 5 else 1.0

            rows = []
            total = 0.0
            for name, price in PRODUCTS:
                sales = max(3, int(rng.uniform(8, 42) * weekend))
                gmv = round(sales * price, 2)
                total += gmv
                rows.append((ds, name, sales, gmv))

            aoe = round(rng.uniform(75, 92), 2)
            orders = max(1, int(total / aoe))
            conv = round(rng.uniform(3.4, 4.8), 2)
            visitors = max(orders + 1, int(orders / (conv / 100)))
            refund = round(rng.uniform(1.2, 3.2), 2)

            conn.execute(
                "INSERT INTO daily_metrics VALUES (?, ?, ?, ?, ?, ?, ?)",
                (ds, round(total, 2), orders, visitors, conv, aoe, refund),
            )
            conn.executemany("INSERT INTO product_sales VALUES (?, ?, ?, ?)", rows)

            search = round(rng.uniform(45, 58), 1)
            recommend = round(rng.uniform(22, 32), 1)
            direct = round(rng.uniform(8, 15), 1)
            paid = round(100 - search - recommend - direct, 1)
            conn.executemany(
                "INSERT INTO traffic_sources VALUES (?, ?, ?)",
                [(ds, "search", search), (ds, "recommend", recommend),
                 (ds, "direct", direct), (ds, "paid", max(paid, 0.0))],
            )

        conn.commit()
        print(f"OK: {STORE_DB}（{days} 天，{days * (len(PRODUCTS) + 4)} 行，至 {end.isoformat()}）")
    finally:
        conn.close()


if __name__ == "__main__":
    build()
