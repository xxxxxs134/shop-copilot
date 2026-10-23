"""
C10 RAG 对比评测：固定 20 问，开/关 RAG 各跑一遍，LLM 自动打分，产出 docs/rag-eval.md。

用法（项目根目录，需先启动 uvicorn backend.main:app --port 8000）：
  python -m backend.rag.eval

评分标准（DeepSeek 裁判，0/1/2 分）：
  2 = 正确且有依据（或明确说明知识库未覆盖）
  1 = 方向对但空泛/依据不足
  0 = 错误、编造或答非所问
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import httpx

API = "http://127.0.0.1:8000/v1/chat/completions"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUT_MD = PROJECT_ROOT / "docs" / "rag-eval.md"

# 20 个固定问题（覆盖种子语料主要分类；e2e 后如发现偏差再校准）
QUESTIONS: list[str] = [
    "淘宝店铺的 DSR 评分指的是什么？",
    "新手开店应该如何选品？",
    "写商品标题有哪些注意事项？",
    "直通车投放如何出价比较合理？",
    "直播带货的开场话术有什么技巧？",
    "客户申请退款时商家应该如何处理？",
    "店铺转化率低应该从哪些方面排查？",
    "大促活动的优惠力度应该怎么规划？",
    "发货超时会面临什么处罚？",
    "店铺体验分下降了怎么提升？",
    "什么是店铺的动销率？",
    "如何做好商品的主图点击率？",
    "客服响应时间有什么要求？",
    "付费推广的 ROI 怎么计算？",
    "商品评价管理有哪些要点？",
    "仓储发货怎样减少错发漏发？",
    "平台活动报名的基本条件是什么？",
    "如何分析店铺的流量来源结构？",
    "新品期运营有什么注意事项？",
    "怎样设置店铺的运费模板？",
]

JUDGE_PROMPT = "\n".join(
    [
        "你是电商运营考试阅卷员。根据【问题】【参考知识点】【回答】给回答打分。",
        "参考知识点是内部知识库中与问题最相关的原文片段；知识库可能不含答案。",
        "评分：2=回答正确且与参考知识一致，或明确说明知识库未覆盖；1=方向大致对但空泛/依据不足；0=错误、编造或答非所问。",
        '只输出 JSON：{"score": 0|1|2, "reason": "一句话理由"}',
    ]
)


def _collect_sse(text: str) -> str:
    out: list[str] = []
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            continue
        try:
            obj = json.loads(data)
        except json.JSONDecodeError:
            continue
        choices = obj.get("choices") or []
        if choices:
            content = (choices[0].get("delta") or {}).get("content")
            if content:
                out.append(content)
    return "".join(out)


def ask(question: str, rag: bool, timeout: float = 90.0) -> str:
    resp = httpx.post(
        API,
        json={
            "model": "deepseek-chat",
            "messages": [{"role": "user", "content": question}],
            "rag": rag,
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    return _collect_sse(resp.text)


def judge(question: str, answer: str) -> tuple[int, str]:
    key = _env_key()
    resp = httpx.post(
        "https://api.deepseek.com/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": "deepseek-chat",
            "messages": [
                {"role": "system", "content": JUDGE_PROMPT},
                {
                    "role": "user",
                    "content": f"【问题】{question}\n【回答】{answer}",
                },
            ],
            "temperature": 0,
        },
        timeout=60,
    )
    resp.raise_for_status()
    text = resp.json()["choices"][0]["message"]["content"]
    start, end = text.find("{"), text.rfind("}")
    try:
        obj = json.loads(text[start : end + 1])
        return int(obj.get("score", 0)), str(obj.get("reason", ""))
    except (json.JSONDecodeError, ValueError, TypeError):
        return 0, f"裁判输出无法解析: {text[:80]}"


def _env_key() -> str:
    from dotenv import load_dotenv
    from pathlib import Path as _P

    load_dotenv(_P(__file__).resolve().parents[1] / ".env")
    import os

    return os.getenv("DEEPSEEK_API_KEY", "")


def _with_retry(fn, attempts: int = 3, base_sleep: float = 2.0):
    """限流/瞬断重试（指数退避）。"""
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 — 评测脚本需要兜底重试
            last = exc
            if i < attempts - 1:
                time.sleep(base_sleep * (2**i))
    raise last  # type: ignore[misc]


def main() -> int:
    # 前置检查：服务器可达 + 裁判 key 存在
    try:
        health = httpx.get("http://127.0.0.1:8000/health", timeout=5)
        health.raise_for_status()
    except Exception as exc:
        print(f"[error] 后端不可达（先 uvicorn backend.main:app --port 8000）: {exc}", file=sys.stderr)
        return 1
    if not _env_key():
        print("[error] backend/.env 缺少 DEEPSEEK_API_KEY", file=sys.stderr)
        return 1

    rows: list[dict] = []
    rag_sum = no_rag_sum = 0
    t0 = time.time()
    for i, q in enumerate(QUESTIONS, 1):
        a_rag, a_plain = "", ""
        err = ""
        try:
            a_rag = _with_retry(lambda: ask(q, rag=True))
            a_plain = _with_retry(lambda: ask(q, rag=False))
            s_rag, r_rag = _with_retry(lambda: judge(q, a_rag))
            s_plain, r_plain = _with_retry(lambda: judge(q, a_plain))
        except Exception as exc:  # noqa: BLE001 — 单题失败不影响整场
            err = f"{type(exc).__name__}: {exc}"
            s_rag = s_plain = -1
            r_rag = r_plain = err[:80]
        rag_sum += max(s_rag, 0)
        no_rag_sum += max(s_plain, 0)
        rows.append(
            {
                "q": q,
                "s_rag": s_rag,
                "r_rag": r_rag,
                "s_plain": s_plain,
                "r_plain": r_plain,
                "a_rag": a_rag,
                "a_plain": a_plain,
            }
        )
        print(f"[{i:02d}/20] rag={s_rag} plain={s_plain} | {q}")

    n = len(QUESTIONS)
    lines = [
        "# RAG 开/关对比评测（C10）",
        "",
        f"- 生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}，耗时 {time.time() - t0:.0f}s",
        f"- 问题数：{n}；裁判：DeepSeek（0/1/2 分）",
        f"- **有 RAG 总分：{rag_sum} / {n * 2}；无 RAG 总分：{no_rag_sum} / {n * 2}**",
        "",
        "| # | 问题 | RAG 分 | 无RAG 分 | RAG 理由（节选） |",
        "|---|------|--------|----------|------------------|",
    ]
    for i, r in enumerate(rows, 1):
        reason = (r["r_rag"] or "").replace("|", "/")[:40]
        lines.append(f"| {i} | {r['q']} | {r['s_rag']} | {r['s_plain']} | {reason} |")
    lines += [
        "",
        "## 结论口径",
        "",
        f"- 有 RAG 平均分：{rag_sum / n:.2f}；无 RAG 平均分：{no_rag_sum / n:.2f}",
        "- 判定：有 RAG 组显著更高 → C10 通过（否则检查检索质量/知识库覆盖）。",
        "",
        "## 完整回答样例（前 3 问）",
        "",
    ]
    for r in rows[:3]:
        lines += [
            f"### {r['q']}",
            "",
            f"**有 RAG（{r['s_rag']} 分）**：{r['a_rag'][:400]}",
            "",
            f"**无 RAG（{r['s_plain']} 分）**：{r['a_plain'][:400]}",
            "",
        ]

    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n报告已写入: {OUT_MD}")
    print(f"有RAG {rag_sum} vs 无RAG {no_rag_sum}（满分 {n * 2}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
