"""
C10-v2 RAG 评测：引用有据性评分。

与 v1 的区别（docs/tech-plan.md D6）：
- v1 发现裸模型常识题已很强（26 vs 23/40），RAG 优势被低估
- v2 评分标准改为「有据性」：回答必须带 [n] 角标、且引用内容与检索片段一致才得 2 分
- 问题全部取自种子语料的具体细节（规则数值、处罚标准等），裸模型难凭常识答对

用法（项目根目录，需先启动 uvicorn backend.app.main:app --port 8000）：
  python -m backend.app.rag.eval_v2

评分标准（DeepSeek 裁判，0/1/2 分）：
  2 = 回答正确 + 有 [n] 引用 + 引用内容与提供的检索片段一致
  1 = 回答方向对但无引用，或引用了但内容不完全一致
  0 = 错误、编造、或明显与检索片段矛盾
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import httpx

API = "http://127.0.0.1:8000/v1/chat/completions"
PROJECT_ROOT = Path(__file__).resolve().parents[3]
OUT_MD = PROJECT_ROOT / "docs" / "rag-eval-v2.md"

# 15 个语料特有问题（答案只在种子语料里，裸模型难凭预训练答对）
QUESTIONS: list[str] = [
    "淘宝 DSR 评分包含哪三项？",
    "新手开店保证金大概需要多少？",
    "商品标题最多可以写多少个字符？",
    "直通车出价过高时的止损建议是什么？",
    "直播开场话术的 FABE 结构是什么？",
    "客服首次响应时间的要求是多少？",
    "发货超时一般会受到什么处罚？",
    "体验分下降后恢复周期通常多久？",
    "新店流量扶持期一般是多长时间？",
    "商品主图点击率的优化方法有哪些？",
    "退款率过高会触发什么后果？",
    "大促活动报名的基本条件是什么？",
    "短视频带货的前3秒钩子有哪些类型？",
    "仓储错发漏发的质检流程要点是什么？",
    "满减优惠和店铺券可以叠加吗？一般规则？",
]


def _env_key() -> str:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
    import os

    return os.getenv("DEEPSEEK_API_KEY", "")


def ask(question: str, rag: bool) -> str:
    """调用后端聊天接口，返回纯文本回答。"""
    key = _env_key()
    payload = {
        "messages": [{"role": "user", "content": question}],
        "stream": True,
        "model": "deepseek-chat",
        "rag": rag,
    }
    resp = httpx.post(
        API, json=payload, headers={"Authorization": f"Bearer {key}"}, timeout=90
    )
    resp.raise_for_status()
    parts: list[str] = []
    for line in resp.text.splitlines():
        if not line.startswith("data: "):
            continue
        data = line[6:].strip()
        if data == "[DONE]":
            break
        try:
            obj = json.loads(data)
            delta = obj["choices"][0].get("delta", {})
            if "content" in delta and delta["content"]:
                parts.append(delta["content"])
        except (json.JSONDecodeError, KeyError, IndexError):
            continue
    return "".join(parts)


def judge(question: str, answer: str, context: str) -> tuple[int, str]:
    """引用有据性评分：0/1/2。context 为检索片段（无 RAG 时为空）。"""
    key = _env_key()
    if context:
        prompt = (
            "你是严格的评审。根据【检索片段】评估【回答】的引用有据性。\n"
            "评分标准：\n"
            "2 = 回答正确 + 带 [1][2] 等角标引用 + 引用内容与检索片段一致\n"
            "1 = 回答方向对但无引用，或引用了但内容不完全一致\n"
            "0 = 错误、编造、或与检索片段明显矛盾\n\n"
            f"【检索片段】\n{context}\n\n"
            f"【问题】{question}\n\n"
            f"【回答】{answer}\n\n"
            "只输出 JSON：{\"score\": 0|1|2, \"reason\": \"一句话理由\"}"
        )
    else:
        prompt = (
            "你是严格的评审。评估【回答】是否正确回答了【问题】。\n"
            "评分标准：2=正确且具体；1=方向对但空泛；0=错误或答非所问。\n"
            "注意：无检索片段时，不要因为缺少引用而扣分。\n\n"
            f"【问题】{question}\n\n"
            f"【回答】{answer}\n\n"
            "只输出 JSON：{\"score\": 0|1|2, \"reason\": \"一句话理由\"}"
        )
    resp = httpx.post(
        "https://api.deepseek.com/chat/completions",
        json={
            "model": "deepseek-chat",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
        },
        headers={"Authorization": f"Bearer {key}"},
        timeout=60,
    )
    resp.raise_for_status()
    text = resp.json()["choices"][0]["message"]["content"]
    # 解析 JSON（可能包 ```json）
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        import re

        m = re.search(r"\{.*\}", text, re.DOTALL)
        if not m:
            return 0, f"裁判输出无法解析: {text[:80]}"
        try:
            obj = json.loads(m.group(0))
        except json.JSONDecodeError:
            return 0, f"裁判输出无法解析: {text[:80]}"
    return int(obj.get("score", 0)), str(obj.get("reason", ""))[:100]


def _with_retry(fn, attempts: int = 3, base_sleep: float = 2.0):
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            last = exc
            if i < attempts - 1:
                time.sleep(base_sleep * (2**i))
    raise last  # type: ignore[misc]


def _get_context(question: str) -> str:
    """同步获取检索片段拼接（供裁判参考）。与生成端 _build_rag_system 完全对齐：
    同一 retrieve()、同样的编号、完整原文（不做截断，否则裁判看不到生成端
    实际看到的内容，会把正确引用误判为"超出片段"）。"""
    from ..rag.retrieve import retrieve

    hits = retrieve(question)
    return "\n\n".join(f"[{i}] 《{h.title}》\n{h.text}" for i, h in enumerate(hits, 1))


def main() -> int:
    key = _env_key()
    if not key:
        print("[error] 缺少 DEEPSEEK_API_KEY（backend/.env）", file=sys.stderr)
        return 1

    rows: list[dict] = []
    total_rag = total_plain = 0

    for i, q in enumerate(QUESTIONS, 1):
        context = _get_context(q)
        try:
            a_rag = _with_retry(lambda: ask(q, rag=True))
            a_plain = _with_retry(lambda: ask(q, rag=False))
            s_rag, r_rag = _with_retry(lambda: judge(q, a_rag, context))
            s_plain, r_plain = _with_retry(lambda: judge(q, a_plain, ""))
        except Exception as exc:  # noqa: BLE001
            err = f"{type(exc).__name__}: {exc}"
            s_rag = s_plain = -1
            r_rag = r_plain = err[:80]
            a_rag = a_plain = ""

        total_rag += max(s_rag, 0)
        total_plain += max(s_plain, 0)
        rows.append({
            "i": i,
            "q": q,
            "s_rag": s_rag,
            "s_plain": s_plain,
            "r_rag": r_rag,
            "r_plain": r_plain,
            "a_rag": a_rag[:150],
            "a_plain": a_plain[:150],
        })
        print(f"[{i}/{len(QUESTIONS)}] rag={s_rag} plain={s_plain} | {q}", flush=True)
        time.sleep(1.0)  # 防限流

    # 写报告
    lines = [
        "# RAG 评测 v2 — 引用有据性评分",
        "",
        "> 与 v1（docs/rag-eval.md）的区别：问题取自语料细节，评分标准为「正确+有引用+引用一致」。",
        "",
        f"**结果：有 RAG {total_rag} vs 无 RAG {total_plain}（满分 {len(QUESTIONS) * 2}）**",
        "",
        "| # | 问题 | RAG | 无RAG | RAG 理由 | 无RAG 理由 |",
        "|---|------|-----|-------|----------|------------|",
    ]
    for r in rows:
        lines.append(
            f"| {r['i']} | {r['q']} | {r['s_rag']} | {r['s_plain']} | {r['r_rag']} | {r['r_plain']} |"
        )
    lines.append("")
    lines.append("## 样例回答（RAG 组前 5 题）")
    lines.append("")
    for r in rows[:5]:
        lines.append(f"**Q{r['i']}: {r['q']}**")
        lines.append("")
        lines.append(f"> {r['a_rag']}")
        lines.append("")
    lines.append(f"_生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}_")

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"报告已写入 {OUT_MD}")
    print(f"有RAG {total_rag} vs 无RAG {total_plain}（满分 {len(QUESTIONS) * 2}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
