"""意图分流（P5-A）：单次 DeepSeek 分类 + 中文关键词启发式兜底 + 实体/情感增强。

契约（docs/plan-p5.md §2.1）：
    classify(q) -> {"intent": knowledge|data|policy|copywriting|general,
                    "target": rag|agent,
                    "reason": "一句话中文理由（供 chip 展示）",
                    "entities": {...结构化实体，仅含识别到的键...},
                    "sentiment": {"label": ..., "score": ..., "cues": [...]}}

路由规则（非对称，防误伤）：data/policy/copywriting → agent；knowledge/general → rag。
延迟目标 <1.5s：temperature=0、max_tokens 小、LLM 预算超时即降级。
LLM 调用失败或 JSON 解析失败 → 关键词兜底；本模块任何路径都不抛异常，
端点层（api_intent.py）再包一层 catch-all 返回 general，保证永不 500。
实体抽取与情感检测为纯本地正则/关键词启发式（零 LLM、零网络），在两条分类路径后统一附加。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

# 读取 backend/.env 中的密钥（不进 git；与 main.py 同一模式，层级多一层 agent/）
load_dotenv(Path(__file__).parent.parent.parent / ".env")

logger = logging.getLogger("shop-copilot.intent")

# 五类意图；路由表集中在此处，intent → target 一处维护
INTENTS = ("knowledge", "data", "policy", "copywriting", "general")
TARGET_OF: dict[str, str] = {
    "data": "agent",
    "policy": "agent",
    "copywriting": "agent",
    "knowledge": "rag",
    "general": "rag",
}
_LABEL = {
    "data": "数据查询",
    "policy": "合规检查",
    "copywriting": "文案创作",
    "knowledge": "知识问答",
    "general": "通用问题",
}

# LLM 端到端预算（秒）：保证 /v1/intent 总延迟 <1.5s，超时立即走关键词兜底
LLM_BUDGET_S = 1.3

SYSTEM_PROMPT = """你是电商运营助手的意图分类器。把用户问题严格分类为以下五类之一：
- data：查经营数据或业务状态（订单/库存/价格/物流/退款进度/售后/GMV/销售额等）
- policy：平台规则与合规问题（退款规则/违规/处罚/保证金/资质等）
- copywriting：创作请求（商品标题/文案/卖点/话术/描述等）
- knowledge：概念定义与方法论等知识问答（如"DSR 评分是什么"）
- general：寒暄、闲聊或无法归类

只输出严格 JSON，禁止任何解释、代码围栏或额外文字，格式：
{"intent":"data","reason":"查订单退款进度，属业务数据查询"}
reason 为一句简短中文（不超过 20 字）。"""

# 关键词启发式兜底，元组顺序即判定优先级
# （"退款进度"归 data，必须整组先于 policy 的"退款"判定；
#  "销售额" 为计划书 data 示例「今天销售额多少」补集，其余严格按 §2.1 清单）
_FALLBACK_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("data", ("订单", "库存", "价格", "物流", "退款进度", "售后", "GMV", "数据", "销售额", "查")),
    ("policy", ("退款", "违规", "处罚", "合规", "保证金")),
    ("copywriting", ("标题", "文案", "卖点", "话术")),
)

# ── 实体抽取词表：纯正则/词表启发式（零 LLM、零网络）──
# 商品词：长词优先判定，避免「充电宝」被「包」截胡
_PRODUCT_KEYWORDS: tuple[str, ...] = (
    "充电宝", "T恤", "收纳", "鞋子", "衣服", "耳机", "水杯", "毯子", "镜子", "饭盒", "包",
)

# 退货原因：首项为规范化返回值，其余为口语别名
_REASON_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("质量问题", ("质量问题", "质量差", "质量不行")),
    ("不喜欢", ("不喜欢", "不想要")),
    ("色差", ("色差", "颜色不对")),
    ("破损", ("破损", "压坏", "损坏", "碎了")),
    ("坏了", ("坏了", "坏的", "故障")),
    ("大了", ("大了", "太大", "有点大", "偏大", "大一点")),
    ("小了", ("小了", "太小", "有点小", "偏小", "小一点")),
)

# 意图动作：首项为规范化返回值，其余为口语别名；表序即判定优先级
_ACTION_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("改地址", ("改地址", "改收货地址", "修改地址")),
    ("拦截", ("拦截", "别发货", "不发货")),
    ("查单", ("查单", "查订单", "查物流", "到哪了")),
    ("投诉", ("投诉", "举报")),
    ("换货", ("换货", "调换")),
    ("退货", ("退货", "退回", "退掉", "退那个", "退这个")),
    ("退款", ("退款", "退钱", "退我")),
)

# 时间表达：固定词 + 「3天前 / 2周后」数字式；取文本中最早出现者
_TIME_WORDS: tuple[str, ...] = ("前天", "昨天", "今天", "上周", "本周", "最近", "刚才")
_TIME_RE = re.compile(r"\d+\s*(?:天|日|周|小时|个月)\s*[前后]")
# 金额：¥159 / 199元 / 80 块（块钱）
_AMOUNT_RE = re.compile(r"[¥￥]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|块钱|块)")
# 订单号：SO + 8~12 位数字
_ORDER_ID_RE = re.compile(r"SO\d{8,12}", re.IGNORECASE)

# ── 情感线索词：纯关键词启发式（零 LLM、零网络）──
# 表序即同票优先级：angry > anxious > frustrated > positive
_SENTIMENT_CUES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("angry", ("投诉", "差评", "垃圾", "骗人", "太慢", "受不了", "气死", "太过分")),
    ("anxious", ("等太久", "什么时候", "怎么办", "还没", "快点", "担心", "催了", "急", "催")),
    ("frustrated", ("怎么又", "搞不定", "折腾", "麻烦", "到底", "还是", "又")),
    ("positive", ("谢谢", "满意", "不错", "好评", "点赞", "很好")),
)
# 长词优先的非重叠匹配：「催了」命中后不再重复计「催」
_SENTIMENT_RE: dict[str, re.Pattern[str]] = {
    label: re.compile("|".join(re.escape(cue) for cue in sorted(cues, key=len, reverse=True)))
    for label, cues in _SENTIMENT_CUES
}


def _build(intent: str, reason: str) -> dict[str, str]:
    """组装契约返回体（intent → target 映射统一走 TARGET_OF）。"""
    return {"intent": intent, "target": TARGET_OF[intent], "reason": reason}


def _extract_json(text: str) -> dict[str, Any] | None:
    """从 LLM 输出提取第一个 {...} 块并解析；容忍 ```json 围栏与前后杂文。"""
    cleaned = re.sub(r"```[a-zA-Z]*", "", text)
    decoder = json.JSONDecoder()
    idx = cleaned.find("{")
    while idx >= 0:
        try:
            obj, _end = decoder.raw_decode(cleaned[idx:])
        except json.JSONDecodeError:
            idx = cleaned.find("{", idx + 1)  # 第一个 { 不是合法 JSON，试下一个
            continue
        return obj if isinstance(obj, dict) else None
    return None


def fallback_classify(q: str) -> dict[str, str]:
    """中文关键词启发式兜底（LLM 失败/坏 JSON 时使用），纯同步、零网络。"""
    for intent, keywords in _FALLBACK_RULES:
        for kw in keywords:
            if kw in q:
                return _build(intent, f"关键词命中「{kw}」→{_LABEL[intent]}")
    return _build("knowledge", "未命中业务关键词，按知识问答处理")


def _parse_llm_content(content: str) -> dict[str, str] | None:
    """解析 LLM 返回的 JSON；非法 intent/坏 JSON 返回 None（由调用方降级兜底）。"""
    obj = _extract_json(content)
    if obj is None:
        logger.warning("意图分类 JSON 解析失败，转关键词兜底: %.120r", content)
        return None
    intent = obj.get("intent")
    if intent not in INTENTS:
        logger.warning("意图分类 intent 非法 %r，转关键词兜底", intent)
        return None
    reason = obj.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        reason = f"模型判定为{_LABEL[intent]}"
    return _build(str(intent), reason.strip())


async def _llm_classify(q: str) -> dict[str, str] | None:
    """单次 DeepSeek chat completion（temperature=0，小 max_tokens）；None = 需兜底。"""
    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key:
        logger.warning("缺少 DEEPSEEK_API_KEY，意图分类转关键词兜底")
        return None
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": q},
        ],
        "temperature": 0,
        "max_tokens": 120,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=1.0)) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
    except httpx.HTTPError as exc:
        logger.warning("意图分类连接 DeepSeek 失败，转关键词兜底: %s", exc)
        return None
    if resp.status_code != 200:
        logger.warning("意图分类 DeepSeek 返回 %s，转关键词兜底", resp.status_code)
        return None
    try:
        content = resp.json()["choices"][0]["message"].get("content") or ""
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        logger.warning("意图分类响应结构异常，转关键词兜底: %s", exc)
        return None
    return _parse_llm_content(str(content))


def _extract_entities(text: str) -> dict[str, Any]:
    """正则 + 词表抽取结构化实体（order_id/product/reason/amount/time_expr/action）。

    纯本地启发式、零 LLM；只返回识别到的键，不塞 null。
    """
    entities: dict[str, Any] = {}

    m = _ORDER_ID_RE.search(text)
    if m:
        entities["order_id"] = m.group(0).upper()

    for kw in _PRODUCT_KEYWORDS:
        if kw in text:
            entities["product"] = kw
            break

    for canonical, aliases in _REASON_KEYWORDS:
        if any(alias in text for alias in aliases):
            entities["reason"] = canonical
            break

    m = _AMOUNT_RE.search(text)
    if m:
        raw = m.group(1) or m.group(2) or "0"
        entities["amount"] = float(raw) if "." in raw else int(raw)

    candidates: list[tuple[int, str]] = [(m.start(), m.group(0)) for m in _TIME_RE.finditer(text)]
    candidates += [(idx, word) for word in _TIME_WORDS if (idx := text.find(word)) >= 0]
    if candidates:
        entities["time_expr"] = min(candidates, key=lambda item: item[0])[1]

    for canonical, aliases in _ACTION_KEYWORDS:
        if any(alias in text for alias in aliases):
            entities["action"] = canonical
            break
    else:
        # 口语单说「退」：带金额按退款（帮我退 80 块）、带商品按退货（退那个鞋子），否则不猜
        if "退" in text and ("amount" in entities or "product" in entities):
            entities["action"] = "退款" if "amount" in entities else "退货"

    return entities


def _detect_sentiment(text: str) -> dict[str, Any]:
    """关键词启发式情感检测，返回 {label, score, cues}，纯本地、零 LLM。

    score 为情绪强度启发式：0.4 + 0.2×线索词数（封顶 1.0），neutral 恒 0.0。
    多类同票时按表序取先（angry > anxious > frustrated > positive）。
    """
    hits: dict[str, list[str]] = {}
    for label, pattern in _SENTIMENT_RE.items():
        matched = list(dict.fromkeys(pattern.findall(text)))
        if matched:
            hits[label] = matched
    label, cues = "neutral", []
    for cand_label, cand_cues in hits.items():  # 插入序即表序，严格大于保证同票留更严重者
        if len(cand_cues) > len(cues):
            label, cues = cand_label, cand_cues
    score = 0.0 if label == "neutral" else round(min(1.0, 0.4 + 0.2 * len(cues)), 1)
    return {"label": label, "score": score, "cues": cues}


async def classify(q: str) -> dict[str, Any]:
    """意图分流主入口：LLM 分类 → 失败/坏 JSON/超时转关键词兜底，再附加实体与情感；任何情况不抛异常。"""
    text = q if isinstance(q, str) else ""
    try:
        result = await asyncio.wait_for(_llm_classify(text), timeout=LLM_BUDGET_S)
    except asyncio.TimeoutError:
        logger.warning("意图分类 LLM 超时(%.1fs)，转关键词兜底", LLM_BUDGET_S)
        result = None
    except Exception as exc:  # 防御：一切意外转兜底并记录，不静默吞掉
        logger.exception("意图分类未预期异常，转关键词兜底: %s", exc)
        result = None
    if result is None:
        result = fallback_classify(text)
    merged: dict[str, Any] = dict(result)
    merged["entities"] = _extract_entities(text)  # 纯本地启发式，快速且不抛异常
    merged["sentiment"] = _detect_sentiment(text)
    return merged
