"""
C9 检索质量自测：10 条查询，top-3 命中期望分类 ≥ 8/10 通过。

用法（项目根目录）：
  python -m backend.app.rag.selftest
"""

from __future__ import annotations

import sys

from .retrieve import Retriever

# (查询, 期望 top-3 中至少出现一次的分类)
CASES: list[tuple[str, str]] = [
    ("淘宝 DSR 评分是什么怎么算", "平台规则常识"),
    ("新手开店怎么选品有什么方法", "选品方法"),
    ("商品标题怎么写才能有搜索流量", "标题与搜索优化"),
    ("直通车投放有什么出价技巧", "付费推广"),
    ("直播带货开场话术有什么技巧", "内容电商与直播"),
    ("客户申请退款我该怎么处理", "客服与售后"),
    ("店铺转化率低应该从哪里排查", "数据指标解读"),
    ("大促活动怎么策划优惠力度", "活动与促销"),
    ("发货超时会有什么处罚", "物流与仓储"),
    ("体验分下降了怎么提升", "账号与体验分"),
]


def main() -> int:
    try:
        retriever = Retriever()
    except FileNotFoundError as exc:
        print(f"[fail] {exc}", file=sys.stderr)
        return 1

    passed = 0
    for query, expected in CASES:
        hits = retriever.retrieve(query, top_k=3)
        cats = [h.category for h in hits]
        ok = expected in cats
        passed += int(ok)
        print(f"[{'PASS' if ok else 'FAIL'}] {query}\n         → top3={cats} 期望={expected}")

    rate = passed / len(CASES)
    print(f"top-3 相关率: {passed}/{len(CASES)} = {rate:.0%}（要求 ≥80%）")
    return 0 if passed >= 8 else 1


if __name__ == "__main__":
    raise SystemExit(main())
