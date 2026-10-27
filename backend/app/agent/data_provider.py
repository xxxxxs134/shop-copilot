"""数据源 Provider 插件化（对标 RTY798/ai-customer-service-agent 三步接入法）。

契约（docs/plan-p4.md §3.3）：
- DataProvider.get_snapshot(date=None) -> dict  — data_query 工具的唯一依赖
- 默认 SqliteStoreProvider：对 data/store.db 做真实 SQL 查询（30 天日粒度数据）
- MockProvider：原样例数据兜底（DATA_PROVIDER=mock 或索引缺失时自动回退）
- 接入真实店铺 = 实现同一 Protocol，再改 .env 一行 DATA_PROVIDER

P5 扩展（docs/plan-p5.md §3.2）：Protocol 新增 5 个**可选**方法
- get_products / get_orders / get_aftersales —— 业务查询（商品/订单/售后）
- validate_refund / execute_refund —— 两段式退款（校验发令牌 / 凭令牌执行）
- 未实现这些方法的老 Provider 不会崩：工具层经 products_json 等包装函数
  降级返回 {"ok": false, "error": "..."}；get_snapshot 契约保持不变。

切换：backend/.env 中 DATA_PROVIDER=sqlite|mock（默认 sqlite）
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from datetime import date
from pathlib import Path
from typing import Callable, Protocol

STORE_DB = Path(__file__).resolve().parents[3] / "data" / "store.db"

REFUND_TOKEN_TTL = 600      # 退款确认令牌有效期：10 分钟（内存 dict，跨轮对话复用）
REFUND_WINDOW_DAYS = 7      # 售后期：下单后 7 天内可自助退款


class DataProvider(Protocol):
    """data_query 的唯一契约：返回快照 dict。

    P5 起附带 5 个可选业务方法（见模块文档）；老实现只需 get_snapshot，
    工具层会检测缺失并优雅降级，不会抛 AttributeError。
    """

    name: str

    def get_snapshot(self, date: str | None = None) -> dict: ...

    # ── P5 可选方法（未实现时工具层降级为 {ok:false, error}）──
    def get_products(self, keyword: str | None = None) -> list[dict]: ...

    def get_orders(self, order_id: str | None = None, status: str | None = None) -> list[dict]: ...

    def get_aftersales(self, order_id: str | None = None) -> list[dict]: ...

    def validate_refund(self, order_id: str, amount: float | int | str | None = None) -> dict: ...

    def execute_refund(self, order_id: str, token: str) -> dict: ...


# ────────────────── 退款两段式共用逻辑（Mock / Sqlite 通用） ─────────────────

_refund_tokens: dict[str, dict] = {}  # token → {order_id, amount, expires_at}（进程内存，跨轮对话复用）


def _issue_refund_token(order_id: str, amount: float) -> str:
    """签发退款确认令牌（TTL 10 分钟）；顺带清理过期项，避免内存泄漏。"""
    now = time.time()
    for stale in [t for t, rec in _refund_tokens.items() if rec["expires_at"] <= now]:
        del _refund_tokens[stale]
    token = uuid.uuid4().hex[:12]
    _refund_tokens[token] = {
        "order_id": order_id,
        "amount": amount,
        "expires_at": now + REFUND_TOKEN_TTL,
    }
    return token


def _verify_refund_token(token: str, order_id: str) -> str | None:
    """校验令牌：存在 / 未过期 / 订单匹配。通过返回 None，否则返回违规原因。"""
    rec = _refund_tokens.get(token)
    if rec is None:
        return "无效或已使用的令牌（不存在或已执行），请重新发起 validate"
    if rec["expires_at"] <= time.time():
        del _refund_tokens[token]
        return f"令牌已过期（有效期 {REFUND_TOKEN_TTL // 60} 分钟），请重新发起 validate"
    if rec["order_id"] != order_id:
        return f"令牌与订单不匹配（令牌对应 {rec['order_id']}，当前 {order_id}）"
    return None


def _consume_refund_token(token: str) -> None:
    """一次性消费：执行成功即删除，重复 execute 走幂等分支。"""
    _refund_tokens.pop(token, None)


def _within_refund_window(created_at: str) -> bool:
    """是否仍在售后期（下单后 7 天内）；日期无法解析时保守视为超期。"""
    try:
        created = date.fromisoformat(str(created_at)[:10])
    except (TypeError, ValueError):
        return False
    return (date.today() - created).days <= REFUND_WINDOW_DAYS


def _coerce_amount(raw: object) -> float | None:
    """把模型传来的金额规范化为 float；无法解析返回 None（不信任传参）。"""
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _refund_violations(order: dict | None, amount_raw: object, aftersales_done: bool) -> list[str]:
    """退款业务校验（全部后端侧，不信任模型传参）。返回违规列表，空 = 通过。"""
    if order is None:
        return ["订单不存在或无权查询"]
    violations: list[str] = []
    status = str(order.get("status", ""))
    if status == "unpaid":
        violations.append("订单未付款，不能退款")
    elif status == "refunding":
        violations.append("该订单已有进行中的退款申请，请勿重复发起")
    elif status == "refunded" or aftersales_done:
        violations.append("订单已退款，无需重复退款")
    amount = _coerce_amount(amount_raw)
    if amount is None:
        violations.append(f"退款金额无效: {amount_raw!r}（必须是数字）")
        return violations
    if amount <= 0:
        violations.append("退款金额必须大于 0")
    elif amount > float(order.get("amount") or 0):
        violations.append(f"退款金额 {amount} 超过实付金额 {order.get('amount')}")
    if not _within_refund_window(str(order.get("created_at", ""))):
        violations.append(f"订单已超过 {REFUND_WINDOW_DAYS} 天售后期，无法自助退款")
    return violations


def _refund_preview(order: dict, amount: float) -> dict:
    """确认预览：模型复述给用户征求确认（plan-p5 §3.3 ②）。"""
    try:
        items = json.loads(order.get("items_json") or "[]")
    except (TypeError, ValueError):
        items = []
    if items:
        first = items[0]
        item = f"{first.get('name') or first.get('sku', '商品')} ×{first.get('qty', 1)}"
        if len(items) > 1:
            item += f" 等 {len(items)} 件"
    else:
        item = "（订单无商品明细）"
    return {
        "order_id": order.get("order_id"),
        "amount": round(amount, 2),
        "item": item,
        "after_amount": round(float(order.get("amount") or 0) - amount, 2),
    }


def _run_validate(order: dict | None, amount: object, aftersales_done: bool) -> dict:
    """validate 段：通过 → 发令牌 + 预览；不通过 → {ok:false, violations:[...]}。"""
    violations = _refund_violations(order, amount, aftersales_done)
    coerced = _coerce_amount(amount)
    if violations or order is None or coerced is None:
        return {"ok": False, "violations": violations or ["订单不存在或无权查询"]}
    locked = round(coerced, 2)
    token = _issue_refund_token(str(order["order_id"]), locked)
    return {
        "ok": True,
        "needs_confirm": True,
        "token": token,
        "preview": _refund_preview(order, locked),
    }


def _idempotent_receipt(order: dict, done_row: dict | None) -> dict:
    """重复 execute：订单已退款 → 幂等「已退款」回执（不再校验令牌）。"""
    amount = float((done_row or {}).get("amount") or order.get("amount") or 0)
    return {
        "ok": True,
        "idempotent": True,
        "message": "已退款",
        "receipt": {
            "order_id": order.get("order_id"),
            "refund_amount": round(amount, 2),
            "status": "已退款",
            "note": "该订单此前已完成退款，本次为幂等回执，未重复扣款",
        },
    }


def _run_execute(
    order: dict | None,
    token: str | None,
    done_row: dict | None,
    commit: Callable[[float], int],
) -> dict:
    """execute 段：幂等检查 → 令牌校验（存在/未过期/订单匹配）→ commit 落库 → 回执。

    commit(amount) 由各 Provider 实现（更新 aftersales + orders 两表），返回 aftersales id；
    金额取 validate 时锁定在令牌里的值，不信任 execute 传参。
    """
    if order is None:
        return {"ok": False, "violations": ["订单不存在或无权查询"]}
    if str(order.get("status", "")) == "refunded":
        return _idempotent_receipt(order, done_row)
    if not token:
        return {"ok": False, "violations": ['缺少 token：请先调用 refund_flow(action="validate") 获取确认令牌']}
    err = _verify_refund_token(token, str(order["order_id"]))
    if err:
        return {"ok": False, "violations": [err]}
    amount = float(_refund_tokens[token]["amount"])
    aftersales_id = commit(amount)
    _consume_refund_token(token)
    return {
        "ok": True,
        "message": "退款执行成功",
        "receipt": {
            "order_id": order["order_id"],
            "refund_amount": round(amount, 2),
            "after_amount": round(float(order.get("amount") or 0) - amount, 2),
            "aftersales_id": aftersales_id,
            "status": "已退款",
            "executed_at": date.today().isoformat(),
        },
    }


def _public_order(order: dict) -> dict:
    """对外返回形态：items_json 解析成 items 列表（给模型看更友好）。"""
    d = {k: v for k, v in order.items() if k != "items_json"}
    try:
        d["items"] = json.loads(order.get("items_json") or "[]")
    except (TypeError, ValueError):
        d["items"] = []
        d["items_error"] = "商品明细 JSON 解析失败"
    return d


def _require_table(conn: sqlite3.Connection, table: str) -> None:
    """表缺失（老 store.db 未重建）→ 抛带指引的错误，由工具层转结构化降级。"""
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone()
    if row is None:
        raise RuntimeError(
            f"store.db 缺少 {table} 表（执行 python -m backend.app.agent.seed_store 重建）"
        )


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

# P5 业务样例（内存，供 MockProvider 的 5 个可选方法使用）
_MOCK_PRODUCTS = [
    {"sku": "SKU1001", "name": "纯棉基础款T恤", "price": 79.9, "stock": 320, "status": "在售", "category": "服装"},
    {"sku": "SKU1003", "name": "桌面收纳盒", "price": 49.9, "stock": 4, "status": "在售", "category": "家居"},   # 低库存
    {"sku": "SKU1004", "name": "无线蓝牙耳机", "price": 199.0, "stock": 96, "status": "在售", "category": "数码"},
    {"sku": "SKU1012", "name": "老款帆布双肩包", "price": 99.0, "stock": 0, "status": "下架", "category": "箱包"},
]

_MOCK_ORDERS: dict[str, dict] = {
    "MOCK1001": {
        "order_id": "MOCK1001", "buyer": "张*", "amount": 199.0, "status": "paid",
        "created_at": date.today().isoformat(),
        "items_json": json.dumps(
            [{"sku": "SKU1004", "name": "无线蓝牙耳机", "price": 199.0, "qty": 1}],
            ensure_ascii=False,
        ),
    },
    "MOCK1002": {
        "order_id": "MOCK1002", "buyer": "王**", "amount": 79.9, "status": "refunded",
        "created_at": date.today().isoformat(),
        "items_json": json.dumps(
            [{"sku": "SKU1001", "name": "纯棉基础款T恤", "price": 79.9, "qty": 1}],
            ensure_ascii=False,
        ),
    },
    "MOCK1003": {
        "order_id": "MOCK1003", "buyer": "李*", "amount": 49.9, "status": "paid",
        "created_at": "2020-01-01",  # 故意远超售后期，演示窗口校验
        "items_json": json.dumps(
            [{"sku": "SKU1003", "name": "桌面收纳盒", "price": 49.9, "qty": 1}],
            ensure_ascii=False,
        ),
    },
}

_MOCK_AFTERSALES: list[dict] = [
    {"id": 1, "order_id": "MOCK1002", "type": "仅退款", "status": "已完成",
     "amount": 79.9, "created_at": date.today().isoformat()},
]


class MockProvider:
    name = "mock"

    def get_snapshot(self, date: str | None = None) -> dict:
        return {
            "date": date or "2026-10-23",
            "source": "mock",
            "data": _MOCK_DATA,
            "note": "样例数据（backend/.env 设 DATA_PROVIDER=sqlite 可切换真实 SQL 查询）",
        }

    # ── P5 可选方法（内存样例；缺数据时返回空列表/结构化违规，不抛异常）──
    def get_products(self, keyword: str | None = None) -> list[dict]:
        kw = (keyword or "").strip().lower()
        if not kw:
            return list(_MOCK_PRODUCTS)
        return [
            p for p in _MOCK_PRODUCTS
            if kw in p["name"].lower() or kw in p["sku"].lower()
        ]

    def get_orders(self, order_id: str | None = None, status: str | None = None) -> list[dict]:
        rows = list(_MOCK_ORDERS.values())
        if order_id:
            rows = [o for o in rows if o["order_id"] == str(order_id)]
        if status:
            rows = [o for o in rows if o["status"] == str(status)]
        return [_public_order(o) for o in rows]

    def get_aftersales(self, order_id: str | None = None) -> list[dict]:
        rows = list(_MOCK_AFTERSALES)
        if order_id:
            rows = [a for a in rows if a["order_id"] == str(order_id)]
        return rows

    def validate_refund(self, order_id: str, amount: float | int | str | None = None) -> dict:
        oid = str(order_id)
        order = _MOCK_ORDERS.get(oid)
        done = any(a["order_id"] == oid and a["status"] == "已完成" for a in _MOCK_AFTERSALES)
        return _run_validate(order, amount, done)

    def execute_refund(self, order_id: str, token: str) -> dict:
        oid = str(order_id)
        order = _MOCK_ORDERS.get(oid)
        done_row = next(
            (a for a in _MOCK_AFTERSALES if a["order_id"] == oid and a["status"] == "已完成"),
            None,
        )

        def commit(amount: float) -> int:
            _MOCK_ORDERS[oid]["status"] = "refunded"
            target = next(
                (a for a in _MOCK_AFTERSALES
                 if a["order_id"] == oid and a["status"] in ("退款中", "被拒")),
                None,
            )
            if target is not None:
                target["status"] = "已完成"
                target["amount"] = round(amount, 2)
                return int(target["id"])
            new_id = max((int(a["id"]) for a in _MOCK_AFTERSALES), default=0) + 1
            _MOCK_AFTERSALES.append({
                "id": new_id, "order_id": oid, "type": "仅退款", "status": "已完成",
                "amount": round(amount, 2), "created_at": date.today().isoformat(),
            })
            return new_id

        return _run_execute(order, token, done_row, commit)


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

    # ── P5 可选方法（真实 SQL 查询业务表；表缺失 → 抛带指引的 RuntimeError）──
    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def get_products(self, keyword: str | None = None) -> list[dict]:
        """商品价格/库存查询：关键词模糊匹配 SKU 或名称，留空返回全部。"""
        conn = self._connect()
        try:
            _require_table(conn, "products")
            kw = (keyword or "").strip()
            if kw:
                like = f"%{kw}%"
                rows = conn.execute(
                    "SELECT sku, name, price, stock, status, category FROM products"
                    " WHERE name LIKE ? OR sku LIKE ? ORDER BY sku",
                    (like, like),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT sku, name, price, stock, status, category FROM products ORDER BY sku"
                ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_orders(self, order_id: str | None = None, status: str | None = None) -> list[dict]:
        """订单查询：按单号精确查 / 按状态过滤，均可留空返回全部（最新在前）。"""
        conn = self._connect()
        try:
            _require_table(conn, "orders")
            sql = (
                "SELECT order_id, buyer, items_json, amount, status, created_at"
                " FROM orders WHERE 1=1"
            )
            params: list[str] = []
            if order_id:
                sql += " AND order_id = ?"
                params.append(str(order_id))
            if status:
                sql += " AND status = ?"
                params.append(str(status))
            sql += " ORDER BY created_at DESC, order_id DESC"
            return [_public_order(dict(r)) for r in conn.execute(sql, params).fetchall()]
        finally:
            conn.close()

    def get_aftersales(self, order_id: str | None = None) -> list[dict]:
        """售后单查询：按订单号过滤，留空返回全部。"""
        conn = self._connect()
        try:
            _require_table(conn, "aftersales")
            sql = "SELECT id, order_id, type, status, amount, created_at FROM aftersales"
            params: list[str] = []
            if order_id:
                sql += " WHERE order_id = ?"
                params.append(str(order_id))
            sql += " ORDER BY created_at DESC, id DESC"
            return [dict(r) for r in conn.execute(sql, params).fetchall()]
        finally:
            conn.close()

    def validate_refund(self, order_id: str, amount: float | int | str | None = None) -> dict:
        """退款校验段：订单存在/已付款/未退过/金额≤实付/在售后期 → 发令牌 + 预览。"""
        conn = self._connect()
        try:
            _require_table(conn, "orders")
            _require_table(conn, "aftersales")
            row = conn.execute(
                "SELECT * FROM orders WHERE order_id = ?", (str(order_id),)
            ).fetchone()
            order = dict(row) if row else None
            done = False
            if order is not None:
                done = conn.execute(
                    "SELECT 1 FROM aftersales WHERE order_id = ? AND status = '已完成' LIMIT 1",
                    (str(order["order_id"]),),
                ).fetchone() is not None
            return _run_validate(order, amount, done)
        finally:
            conn.close()

    def execute_refund(self, order_id: str, token: str) -> dict:
        """退款执行段：幂等检查 → 令牌校验 → 更新 aftersales + orders → 回执。"""
        oid = str(order_id)
        conn = self._connect()
        try:
            _require_table(conn, "orders")
            _require_table(conn, "aftersales")
            row = conn.execute("SELECT * FROM orders WHERE order_id = ?", (oid,)).fetchone()
            order = dict(row) if row else None
            done_row = None
            if order is not None:
                drow = conn.execute(
                    "SELECT id, order_id, type, status, amount, created_at FROM aftersales"
                    " WHERE order_id = ? AND status = '已完成' ORDER BY id DESC LIMIT 1",
                    (oid,),
                ).fetchone()
                done_row = dict(drow) if drow else None

            def commit(amount: float) -> int:
                conn.execute(
                    "UPDATE orders SET status = 'refunded' WHERE order_id = ?", (oid,)
                )
                target = conn.execute(
                    "SELECT id FROM aftersales WHERE order_id = ?"
                    " AND status IN ('退款中', '被拒') ORDER BY id DESC LIMIT 1",
                    (oid,),
                ).fetchone()
                if target is not None:
                    aid = int(target["id"])
                    conn.execute(
                        "UPDATE aftersales SET status = '已完成', amount = ? WHERE id = ?",
                        (round(amount, 2), aid),
                    )
                else:
                    cur = conn.execute(
                        "INSERT INTO aftersales (order_id, type, status, amount, created_at)"
                        " VALUES (?, ?, ?, ?, ?)",
                        (oid, "仅退款", "已完成", round(amount, 2), date.today().isoformat()),
                    )
                    aid = int(cur.lastrowid or 0)
                conn.commit()
                return aid

            return _run_execute(order, token, done_row, commit)
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


# ────────────────── P5 工具层包装（可选方法优雅降级） ─────────────────

def _call_optional(method: str, *args: object, **kwargs: object) -> tuple[bool, object]:
    """调用 Provider 的可选方法。未实现/异常 → (False, 错误说明)，绝不向上抛。"""
    provider = get_provider()
    fn = getattr(provider, method, None)
    if not callable(fn):
        return False, (
            f"数据源 {provider.name} 未实现 {method}"
            "（P5 可选方法，接入方式见 data_provider.py 三步接入）"
        )
    try:
        return True, fn(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001 — 工具层兜底，不让 Agent 循环崩
        return False, f"{method} 执行失败: {exc}"


def _list_result(method: str, key: str, *args: object, **kwargs: object) -> str:
    """可选列表方法 → {ok, count, items/...} JSON；失败 → {ok:false, error}。"""
    ok, val = _call_optional(method, *args, **kwargs)
    if not ok:
        return json.dumps({"ok": False, "error": val}, ensure_ascii=False)
    if not isinstance(val, list):
        return json.dumps(
            {"ok": False, "error": f"{method} 返回类型错误: {type(val).__name__}（应为 list）"},
            ensure_ascii=False,
        )
    return json.dumps({"ok": True, "count": len(val), key: val}, ensure_ascii=False)


def _dict_result(method: str, *args: object, **kwargs: object) -> str:
    """可选 dict 方法（validate/execute）→ 原样 JSON；失败 → {ok:false, error}。"""
    ok, val = _call_optional(method, *args, **kwargs)
    if not ok:
        return json.dumps({"ok": False, "error": val}, ensure_ascii=False)
    if not isinstance(val, dict):
        return json.dumps(
            {"ok": False, "error": f"{method} 返回类型错误: {type(val).__name__}（应为 dict）"},
            ensure_ascii=False,
        )
    return json.dumps(val, ensure_ascii=False)


def products_json(keyword: str | None = None) -> str:
    """给 product_lookup 用：商品列表 → JSON 字符串。"""
    return _list_result("get_products", "items", keyword)


def orders_json(order_id: str | None = None, status: str | None = None) -> str:
    """给 order_lookup 用：订单列表 → JSON 字符串。"""
    return _list_result("get_orders", "orders", order_id=order_id, status=status)


def aftersales_json(order_id: str | None = None) -> str:
    """给 order_lookup 用：售后单列表 → JSON 字符串。"""
    return _list_result("get_aftersales", "aftersales", order_id=order_id)


def validate_refund_json(order_id: str, amount: object = None) -> str:
    """给 refund_flow validate 段用：校验结果（含令牌/预览或违规）→ JSON 字符串。"""
    return _dict_result("validate_refund", order_id, amount)


def execute_refund_json(order_id: str, token: str) -> str:
    """给 refund_flow execute 段用：执行回执（或违规/幂等回执）→ JSON 字符串。"""
    return _dict_result("execute_refund", order_id, token)
