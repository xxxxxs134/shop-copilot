"""店智 Copilot — Agent 工具模块（kb_search / data_query / copywriting / policy_check）。

每个工具 = 一个 Tool 实例，注册到 REGISTRY。loop.py 通过 list_schemas() 生成
OpenAI function calling 的 tools 数组，用 name 分发调用。
"""

from __future__ import annotations

import json
from pathlib import Path

from ..rag.retrieve import retrieve
from .tools import Tool, register, param_schema, doc_summary


# ────────────────────────────── kb_search ──────────────────────────────

def _kb_search(query: str) -> str:
    """知识库混合检索（RRF 融合 BM25+向量），返回 top-3 带编号的片段。"""
    hits = retrieve(query)
    if not hits:
        return json.dumps({"found": False, "message": "知识库未覆盖该问题"}, ensure_ascii=False)

    items = []
    for i, h in enumerate(hits[:3], 1):
        items.append({
            "index": i,
            "title": h.title,
            "category": h.category,
            "text": h.text[:400],  # 截断，避免 tool message 过长
        })
    return json.dumps({"found": True, "items": items}, ensure_ascii=False)


register(Tool(
    name="kb_search",
    description="知识库检索：查询平台规则、运营方法论等内部知识。返回带编号的文本片段，回答时引用 [1][2]。",
    parameters=param_schema(
        query={"type": "string", "description": "检索关键词/问题"},
        required=["query"],
    ),
    fn=_kb_search,
))


# ────────────────────────────── data_query ─────────────────────────────

# 预置样例店铺数据（P1 mock，M3 可替换为真实数据源）
_MOCK_SHOP_DATA = {
    "gmv": 12840.50,
    "orders": 156,
    "visitors": 3820,
    "conversion_rate": 4.08,  # %
    "avg_order_value": 82.31,
    "refund_rate": 1.92,  # %
    "top_products": [
        {"name": "纯棉基础款T恤", "sales": 42, "gmv": 3360},
        {"name": "便携式充电宝", "sales": 28, "gmv": 2800},
        {"name": "桌面收纳盒", "sales": 35, "gmv": 1750},
    ],
    "traffic_sources": {"search": 52, "recommend": 28, "direct": 12, "paid": 8},
}


def _data_query(query: str) -> str:
    """查询预置店铺经营数据。P1 为 mock 数据。"""
    return json.dumps({
        "date": "2026-10-23",
        "data": _MOCK_SHOP_DATA,
        "note": "当前为样例数据，后续接入真实店铺数据源",
    }, ensure_ascii=False)


register(Tool(
    name="data_query",
    description="查询店铺经营数据（GMV/订单/访客/转化率/退款率/热销品/流量来源）。",
    parameters=param_schema(
        query={"type": "string", "description": "自然语言查询，如：今日GMV、热销品、流量来源"},
        required=["query"],
    ),
    fn=_data_query,
))


# ────────────────────────────── copywriting ────────────────────────────

def _copywriting(product_name: str, selling_points: str) -> str:
    """生成商品文案（P1 简化版，M3 可接 GLM-4V 或 DeepSeek 专门 prompt）。"""
    points = [p.strip() for p in selling_points.split("；") if p.strip()]
    points_text = "、".join(points[:3]) if points else "品质保证"
    return json.dumps({
        "title": f"{product_name}｜{points_text}",
        "short_desc": f"精选{product_name}，{points_text}，品质保障，放心购买。",
        "bullet_points": points[:5],
    }, ensure_ascii=False)


register(Tool(
    name="copywriting",
    description="生成商品标题、短描述、卖点列表。",
    parameters=param_schema(
        product_name={"type": "string", "description": "商品名称"},
        selling_points={"type": "string", "description": "核心卖点，用中文分号；分隔"},
        required=["product_name", "selling_points"],
    ),
    fn=_copywriting,
))


# ────────────────────────────── policy_check ───────────────────────────

def _policy_check(scenario: str) -> str:
    """检查某场景是否违规（简化版，规则库在 M3 扩充）。"""
    # 关键词匹配 + 知识库兜底
    hits = retrieve(scenario)
    if hits:
        return json.dumps({
            "scenario": scenario,
            "risk_level": "low",
            "suggestion": f"根据知识库《{hits[0].title}》，{hits[0].text[:200]}",
        }, ensure_ascii=False)
    return json.dumps({
        "scenario": scenario,
        "risk_level": "unknown",
        "suggestion": "知识库未覆盖该场景，建议人工复核",
    }, ensure_ascii=False)


register(Tool(
    name="policy_check",
    description="检查某运营场景（如改价、上新、活动报名）是否违规，返回风险等级与建议。",
    parameters=param_schema(
        scenario={"type": "string", "description": "待检查的场景描述"},
        required=["scenario"],
    ),
    fn=_policy_check,
))
