"""意图路由节点：把客户消息分类为 售前 / 售后 / 投诉升级 / 澄清（+ 置信度）。

对齐参考项目（LoongSuite intent_router + RTY798 router_agent 的 4 类意图）：
- presales（售前）：咨询商品、选款、推荐、价格、库存、发货时间等下单前问题
- aftersales（售后）：订单查询、物流、退款、退货、改地址等下单后问题
- escalation（投诉升级）：强烈不满、要求投诉/转人工/找主管
- clarify（澄清）：意图不明确，无法判断

用 json_mode 强制 JSON 输出 + 兜底正则解析。
"""

from __future__ import annotations

import json
import logging
import re

from .llm import chat_json

logger = logging.getLogger("shop-copilot.agent.router")

ROUTER_SYSTEM = """你是电商客服的意图路由，把客户最新一条消息分成四类：

- presales（售前）：客户还没下单，在咨询/挑选/比较商品。包括：有什么商品、有没有适合 XX 的、价格多少、有没有货、库存、规格、发货时间、推荐。
- aftersales（售后）：客户已经下单或收货，在办订单相关的事。包括：查订单、查物流、退款、退货、改地址。
- escalation（投诉升级）：客户表达强烈不满、愤怒、明确要求投诉/转人工/找主管。包括："我要投诉"、"叫你们经理来"、"太差了我要曝光"。
- clarify（澄清）：只有消息信息量极少、实在看不出客户要什么时，才归这一类（如「在吗」「帮帮我」）。

判断规则：
1. 提到「商品、鞋、衣服、有什么、多少钱、有货、推荐、适合」→ presales
2. 提到「订单、物流、退款、退货、到哪了、改地址」→ aftersales
3. 提到「投诉、曝光、主管、经理、太差、气死、12315、消协」→ escalation
4. 只有极短且完全无信息的话 → clarify

只输出一个 JSON，不要任何其它文字：
{"intent": "presales" 或 "aftersales" 或 "escalation" 或 "clarify", "confidence": 0.0 到 1.0 的小数}"""

_VALID_INTENTS = {"presales", "aftersales", "escalation", "clarify"}


async def classify(messages: list[dict]) -> tuple[str, float]:
    """messages = [*历史, 最新 user]。返回 (intent, confidence)。"""
    data = await chat_json([{"role": "system", "content": ROUTER_SYSTEM}, *messages], temperature=0.0)
    intent = str(data.get("intent", "")).strip().lower()
    if intent not in _VALID_INTENTS:
        intent = "clarify"
    try:
        conf = float(data.get("confidence", 0.0))
    except (TypeError, ValueError):
        conf = 0.0
    logger.info("路由结果: intent=%s confidence=%.2f", intent, conf)
    return intent, max(0.0, min(1.0, conf))
