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
- 咨询即办理：orders 每单带收货地址 address，shipped 单带 carrier/tracking_no
  （供 modify_address / intercept_logistics / return_exchange 两段式工具演示）
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

# P5 业务表种子：12 个商品（sku/name/price/stock/status/category，含 2 个低库存 + 1 个下架）
CATALOG = [
    ("SKU1001", "纯棉基础款T恤", 79.9, 320, "在售", "服装"),
    ("SKU1002", "便携式充电宝", 99.0, 180, "在售", "数码"),
    ("SKU1003", "桌面收纳盒", 49.9, 4, "在售", "家居"),      # 低库存
    ("SKU1004", "无线蓝牙耳机", 199.0, 96, "在售", "数码"),
    ("SKU1005", "儿童保温杯", 69.0, 2, "在售", "母婴"),       # 低库存
    ("SKU1006", "厨房置物架", 129.0, 58, "在售", "家居"),
    ("SKU1007", "遮阳伞晴雨两用", 59.0, 240, "在售", "服饰配件"),
    ("SKU1008", "加厚珊瑚绒毯", 129.0, 75, "在售", "家纺"),
    ("SKU1009", "不锈钢保温饭盒", 89.0, 130, "在售", "厨具"),
    ("SKU1010", "宠物自动饮水机", 159.0, 46, "在售", "宠物"),
    ("SKU1011", "LED化妆镜带灯", 119.0, 88, "在售", "美妆"),
    ("SKU1012", "老款帆布双肩包", 99.0, 0, "下架", "箱包"),
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
        status TEXT NOT NULL,
        category TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS orders (
        order_id TEXT PRIMARY KEY,
        buyer TEXT NOT NULL,
        items_json TEXT NOT NULL,
        amount REAL NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        address TEXT NOT NULL,
        carrier TEXT NOT NULL,
        tracking_no TEXT NOT NULL
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

# 已发货订单的物流信息（运单号固定，保证种子幂等可复现）；非 shipped 订单为空
SHIPPED_LOGISTICS = {
    "007": ("顺丰速运", "SF7392846152738"),
    "008": ("中通快递", "ZT4829173645021"),
    "009": ("圆通速递", "YT9182736455102"),
    "010": ("京东物流", "JD0092837465511"),
}


def _orders_seed(end: date) -> list[tuple]:
    """20 单：状态覆盖 paid/shipped/received/refunding/refunded/unpaid，
    其中 006/014 故意超出 7 天售后期，020 未付款——供退款/退换货校验演示违规分支。

    每单带真实风格的中文收货地址（供 modify_address 两段式演示），
    shipped 单带运单信息（供 intercept_logistics 预览）。"""

    def item(sku: str, name: str, price: float, qty: int) -> dict:
        return {"sku": sku, "name": name, "price": price, "qty": qty}

    plans: list[tuple[str, str, list[dict], str, int, str]] = [
        # (单号后缀, 买家脱敏, 商品明细, 状态, 下单距今天数, 收货地址)
        ("001", "张*", [item("SKU1001", "纯棉基础款T恤", 79.9, 2)], "paid", 1,
         "浙江省杭州市西湖区文三路138号华星时代广场A座1201室"),
        ("002", "王**", [item("SKU1002", "便携式充电宝", 99.0, 1)], "paid", 2,
         "江苏省南京市鼓楼区中山北路105号民国风情街3栋502室"),
        ("003", "李*", [item("SKU1003", "桌面收纳盒", 49.9, 3)], "paid", 3,
         "广东省深圳市南山区科技园科苑路15号腾讯大厦28层"),
        ("004", "陈**", [item("SKU1004", "无线蓝牙耳机", 199.0, 1)], "paid", 5,
         "四川省成都市武侯区天府大道北段1480号拉·德方斯大厦907室"),
        ("005", "赵*", [item("SKU1005", "儿童保温杯", 69.0, 2)], "paid", 6,
         "湖北省武汉市洪山区珞喻路129号光谷广场B区7栋1802室"),
        ("006", "孙**", [item("SKU1006", "厨房置物架", 129.0, 1)], "paid", 15,  # 超售后期
         "山东省青岛市市南区香港中路76号颐中皇冠假日酒店公寓1503室"),
        ("007", "周*", [item("SKU1001", "纯棉基础款T恤", 79.9, 1),
                        item("SKU1003", "桌面收纳盒", 49.9, 1)], "shipped", 2,
         "北京市朝阳区建国路88号SOHO现代城C座2206室"),
        ("008", "吴**", [item("SKU1008", "加厚珊瑚绒毯", 129.0, 1)], "shipped", 4,
         "上海市浦东新区张杨路500号时代广场12楼1204室"),
        ("009", "郑*", [item("SKU1009", "不锈钢保温饭盒", 89.0, 2)], "shipped", 6,
         "陕西省西安市雁塔区科技路38号林凯国际大厦1808室"),
        ("010", "冯**", [item("SKU1010", "宠物自动饮水机", 159.0, 1)], "shipped", 1,
         "福建省厦门市思明区软件园二期观日路26号401单元"),
        ("011", "蒋*", [item("SKU1011", "LED化妆镜带灯", 119.0, 1)], "received", 3,
         "湖南省长沙市岳麓区枫林三路199号麓谷企业广场A2栋1104室"),
        ("012", "沈**", [item("SKU1001", "纯棉基础款T恤", 79.9, 3)], "received", 5,
         "河南省郑州市金水区农业路116号汇城大厦1603室"),
        ("013", "韩*", [item("SKU1002", "便携式充电宝", 99.0, 2)], "received", 6,
         "辽宁省沈阳市和平区太原街78号万达新天地A座1906室"),
        ("014", "杨**", [item("SKU1005", "儿童保温杯", 69.0, 1)], "received", 20,  # 超售后期
         "重庆市渝中区解放碑步行街18号英利国际金融中心3201室"),
        ("015", "朱*", [item("SKU1008", "加厚珊瑚绒毯", 129.0, 2)], "received", 4,
         "天津市南开区南京路219号天津环球金融中心1708室"),
        ("016", "秦**", [item("SKU1004", "无线蓝牙耳机", 199.0, 1)], "refunding", 2,
         "安徽省合肥市蜀山区黄山路599号世纪广场3栋1202室"),
        ("017", "许*", [item("SKU1006", "厨房置物架", 129.0, 1)], "refunding", 3,
         "江西省南昌市红谷滩区凤凰中大道1628号绿地中央广场A区1105室"),
        ("018", "何**", [item("SKU1009", "不锈钢保温饭盒", 89.0, 1)], "refunded", 8,
         "云南省昆明市五华区东风西路121号顺城购物中心W1-1502室"),
        ("019", "吕*", [item("SKU1011", "LED化妆镜带灯", 119.0, 1)], "refunded", 10,
         "广西南宁市青秀区民族大道131号航洋国际城B座2207室"),
        ("020", "施**", [item("SKU1012", "老款帆布双肩包", 99.0, 1)], "unpaid", 0,
         "河北省石家庄市裕华区槐安东路121号万达广场B座1809室"),
    ]
    prefix = f"SO{end.strftime('%Y%m%d')}"
    rows = []
    for suffix, buyer, items, status, days_ago, address in plans:
        amount = round(sum(i["price"] * i["qty"] for i in items), 2)
        carrier, tracking_no = SHIPPED_LOGISTICS.get(suffix, ("", ""))
        rows.append((
            f"{prefix}{suffix}",
            buyer,
            json.dumps(items, ensure_ascii=False),
            amount,
            status,
            (end - timedelta(days=days_ago)).isoformat(),
            address,
            carrier,
            tracking_no,
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
        # 幂等重建：先 DROP 再 CREATE（schema 变更后旧 store.db 也能直接重建）
        for tbl in ("traffic_sources", "product_sales", "daily_metrics",
                    "aftersales", "orders", "products"):
            conn.execute(f"DROP TABLE IF EXISTS {tbl}")
        for stmt in SCHEMA:
            conn.execute(stmt)

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

        # ── P5 业务表（docs/plan-p5.md §3.1）──
        conn.executemany("INSERT INTO products VALUES (?, ?, ?, ?, ?, ?)", CATALOG)
        conn.executemany(
            "INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", _orders_seed(end)
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
