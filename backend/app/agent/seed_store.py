"""生成 30 天店铺经营种子数据 → data/store.db（幂等：整表重建）。

用法（项目根目录）：
  python -m backend.app.agent.seed_store

数据特征（fixed seed，每次生成一致）：
- 週末（六/日）销量 ×1.25，工作日基准
- 6 个商品、日粒度 metrics / product_sales / traffic_sources 三表
- gmv 与商品销量联动，转化率 3.4%~4.8%，退款率 1.2%~3.2%
- P5 业务表（docs/plan-p5.md §3.1）：products 12 商品（含 2 个低库存）、
  orders 20 单（paid/shipped/received/refunding/refunded/unpaid）、
  aftersales 6 条（退款中/已完成/被拒）——同样幂等重建，不入库（store.db 已 gitignore）
"""

from __future__ import annotations

import json
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

# P5 业务表种子：12 个商品（sku/name/price/stock/status，含 2 个低库存 + 1 个下架）
CATALOG = [
    ("SKU1001", "纯棉基础款T恤", 79.9, 320, "在售"),
    ("SKU1002", "便携式充电宝", 99.0, 180, "在售"),
    ("SKU1003", "桌面收纳盒", 49.9, 4, "在售"),      # 低库存
    ("SKU1004", "无线蓝牙耳机", 199.0, 96, "在售"),
    ("SKU1005", "儿童保温杯", 69.0, 2, "在售"),       # 低库存
    ("SKU1006", "厨房置物架", 129.0, 58, "在售"),
    ("SKU1007", "遮阳伞晴雨两用", 59.0, 240, "在售"),
    ("SKU1008", "加厚珊瑚绒毯", 129.0, 75, "在售"),
    ("SKU1009", "不锈钢保温饭盒", 89.0, 130, "在售"),
    ("SKU1010", "宠物自动饮水机", 159.0, 46, "在售"),
    ("SKU1011", "LED化妆镜带灯", 119.0, 88, "在售"),
    ("SKU1012", "老款帆布双肩包", 99.0, 0, "下架"),
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
    # ── P5 业务表（docs/plan-p5.md §3.1）──
    """CREATE TABLE IF NOT EXISTS products (
        sku TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        stock INTEGER NOT NULL,
        status TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS orders (
        order_id TEXT PRIMARY KEY,
        buyer TEXT NOT NULL,
        items_json TEXT NOT NULL,
        amount REAL NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS aftersales (
        id INTEGER PRIMARY KEY,
        order_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        amount REAL NOT NULL,
        created_at TEXT NOT NULL
    )""",
]

# P5 业务表种子行（created_at 相对 end 计算，保证售后期校验可复现）
BUSINESS_TABLES = ("aftersales", "orders", "products")


def _orders_seed(end: date) -> list[tuple]:
    """20 单：状态覆盖 paid/shipped/received/refunding/refunded/unpaid，
    其中 006/014 故意超出 7 天售后期，020 未付款——供退款校验演示违规分支。"""

    def item(sku: str, name: str, price: float, qty: int) -> dict:
        return {"sku": sku, "name": name, "price": price, "qty": qty}

    plans: list[tuple[str, str, list[dict], str, int]] = [
        # (单号后缀, 买家脱敏, 商品明细, 状态, 下单距今天数)
        ("001", "张*", [item("SKU1001", "纯棉基础款T恤", 79.9, 2)], "paid", 1),
        ("002", "王**", [item("SKU1002", "便携式充电宝", 99.0, 1)], "paid", 2),
        ("003", "李*", [item("SKU1003", "桌面收纳盒", 49.9, 3)], "paid", 3),
        ("004", "陈**", [item("SKU1004", "无线蓝牙耳机", 199.0, 1)], "paid", 5),
        ("005", "赵*", [item("SKU1005", "儿童保温杯", 69.0, 2)], "paid", 6),
        ("006", "孙**", [item("SKU1006", "厨房置物架", 129.0, 1)], "paid", 15),  # 超售后期
        ("007", "周*", [item("SKU1001", "纯棉基础款T恤", 79.9, 1),
                        item("SKU1003", "桌面收纳盒", 49.9, 1)], "shipped", 2),
        ("008", "吴**", [item("SKU1008", "加厚珊瑚绒毯", 129.0, 1)], "shipped", 4),
        ("009", "郑*", [item("SKU1009", "不锈钢保温饭盒", 89.0, 2)], "shipped", 6),
        ("010", "冯**", [item("SKU1010", "宠物自动饮水机", 159.0, 1)], "shipped", 1),
        ("011", "蒋*", [item("SKU1011", "LED化妆镜带灯", 119.0, 1)], "received", 3),
        ("012", "沈**", [item("SKU1001", "纯棉基础款T恤", 79.9, 3)], "received", 5),
        ("013", "韩*", [item("SKU1002", "便携式充电宝", 99.0, 2)], "received", 6),
        ("014", "杨**", [item("SKU1005", "儿童保温杯", 69.0, 1)], "received", 20),  # 超售后期
        ("015", "朱*", [item("SKU1008", "加厚珊瑚绒毯", 129.0, 2)], "received", 4),
        ("016", "秦**", [item("SKU1004", "无线蓝牙耳机", 199.0, 1)], "refunding", 2),
        ("017", "许*", [item("SKU1006", "厨房置物架", 129.0, 1)], "refunding", 3),
        ("018", "何**", [item("SKU1009", "不锈钢保温饭盒", 89.0, 1)], "refunded", 8),
        ("019", "吕*", [item("SKU1011", "LED化妆镜带灯", 119.0, 1)], "refunded", 10),
        ("020", "施**", [item("SKU1012", "老款帆布双肩包", 99.0, 1)], "unpaid", 0),
    ]
    prefix = f"SO{end.strftime('%Y%m%d')}"
    rows = []
    for suffix, buyer, items, status, days_ago in plans:
        amount = round(sum(i["price"] * i["qty"] for i in items), 2)
        rows.append((
            f"{prefix}{suffix}",
            buyer,
            json.dumps(items, ensure_ascii=False),
            amount,
            status,
            (end - timedelta(days=days_ago)).isoformat(),
        ))
    return rows


def _aftersales_seed(end: date) -> list[tuple]:
    """6 条售后：2 退款中（对应 refunding 单）/ 2 已完成（对应 refunded 单）/
    2 被拒（对应仍可再申请退款的 received 单）。"""

    def ds(days_ago: int) -> str:
        return (end - timedelta(days=days_ago)).isoformat()

    prefix = f"SO{end.strftime('%Y%m%d')}"
    return [
        (1, f"{prefix}016", "仅退款", "退款中", 199.0, ds(2)),
        (2, f"{prefix}017", "退货退款", "退款中", 129.0, ds(3)),
        (3, f"{prefix}018", "仅退款", "已完成", 89.0, ds(8)),
        (4, f"{prefix}019", "仅退款", "已完成", 119.0, ds(10)),
        (5, f"{prefix}011", "仅退款", "被拒", 119.0, ds(2)),
        (6, f"{prefix}013", "退货退款", "被拒", 198.0, ds(4)),
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

        # ── P5 业务表：幂等重建（与 30 天指标互不影响）──
        for tbl in BUSINESS_TABLES:
            conn.execute(f"DELETE FROM {tbl}")
        conn.executemany("INSERT INTO products VALUES (?, ?, ?, ?, ?)", CATALOG)
        conn.executemany(
            "INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)", _orders_seed(end)
        )
        conn.executemany(
            "INSERT INTO aftersales VALUES (?, ?, ?, ?, ?, ?)", _aftersales_seed(end)
        )
        conn.commit()

        print(f"OK: {STORE_DB}（{days} 天，{days * (len(PRODUCTS) + 4)} 行，至 {end.isoformat()}）")
        counts = {
            tbl: conn.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
            for tbl in BUSINESS_TABLES
        }
        print(
            "OK: 业务表 "
            + " ".join(f"{tbl}={counts[tbl]}" for tbl in ("products", "orders", "aftersales"))
        )
    finally:
        conn.close()


if __name__ == "__main__":
    build()
