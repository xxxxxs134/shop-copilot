"""
混合检索：BM25（关键词）+ 向量（语义），RRF 融合返回 top-k。

- BM25：jieba 分词（无 jieba 时回退字符 bigram），k1=1.5 b=0.75，零额外依赖
- 向量：LanceDB 表向最近邻
- 融合：score = Σ 1/(60 + rank)（RRF，rank 从 1 起）
- 索引缺失时 Retriever() 抛 FileNotFoundError，由调用方降级为无 RAG
"""

from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass

from .pipeline import INDEX_ROOT, get_embedder

RRF_K = 60
DEFAULT_TOP_K = 4


@dataclass
class Hit:
    score: float
    text: str
    title: str
    source: str
    url: str
    category: str
    chunk_index: int


def _tokenize(text: str) -> list[str]:
    try:
        import jieba

        return [t for t in jieba.lcut(text) if t.strip() and not t.isspace()]
    except ImportError:
        ascii_words = re.findall(r"[a-zA-Z0-9]+", text.lower())
        han = re.findall(r"[\u4e00-\u9fff]", text)
        bigrams = ["".join(p) for p in zip(han, han[1:])] or han
        return ascii_words + bigrams


class _BM25:
    def __init__(self, tokenized_docs: list[list[str]], k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.doc_len = [len(d) for d in tokenized_docs]
        self.avg_len = (sum(self.doc_len) / len(self.doc_len)) if self.doc_len else 0.0
        self.doc_freqs: list[dict[str, int]] = []
        df: dict[str, int] = {}
        for doc in tokenized_docs:
            freqs: dict[str, int] = {}
            for tok in doc:
                freqs[tok] = freqs.get(tok, 0) + 1
            self.doc_freqs.append(freqs)
            for tok in freqs:
                df[tok] = df.get(tok, 0) + 1
        n = len(tokenized_docs)
        self.idf = {tok: math.log(1 + (n - f + 0.5) / (f + 0.5)) for tok, f in df.items()}

    def search(self, query: str, top_n: int) -> list[int]:
        """返回按得分降序排列的文档下标（只取前 top_n）。"""
        q_tokens = _tokenize(query)
        scores = [0.0] * len(self.doc_freqs)
        for tok in q_tokens:
            idf = self.idf.get(tok)
            if idf is None:
                continue
            for i, freqs in enumerate(self.doc_freqs):
                tf = freqs.get(tok, 0)
                if tf == 0:
                    continue
                denom = tf + self.k1 * (1 - self.b + self.b * self.doc_len[i] / (self.avg_len or 1))
                scores[i] += idf * tf * (self.k1 + 1) / denom
        ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
        return [i for i in ranked if scores[i] > 0][:top_n]


class Retriever:
    def __init__(self, top_k: int = DEFAULT_TOP_K):
        import lancedb

        self.provider = os.getenv("EMBED_PROVIDER", "local")
        index_dir = INDEX_ROOT / self.provider
        if not (index_dir / "chunks.lance").exists():
            raise FileNotFoundError(f"索引不存在: {index_dir}（先执行 python -m backend.app.rag.pipeline build）")
        self.top_k = top_k
        self._table = lancedb.connect(str(index_dir)).open_table("chunks")
        # 全量载入内存（种子规模 ≈百级块；扩到千级也够用）
        self.rows = self._table.to_pandas().to_dict("records")
        self.bm25 = _BM25([_tokenize(r["text"]) for r in self.rows])
        self._embedder = None  # 懒加载，避免进程启动即拉起模型

    @property
    def embedder(self):
        if self._embedder is None:
            self._embedder = get_embedder()
        return self._embedder

    def retrieve(self, query: str, top_k: int | None = None) -> list[Hit]:
        k = top_k or self.top_k
        # 向量检索：优先 LanceDB ANN，失败时余弦暴力兜底（种子规模可接受）
        vec = self.embedder.embed([query])[0]
        try:
            vec_rank = [self._row_index(h["id"]) for h in self._table.search(vec).limit(k * 2).to_list()]
        except Exception as exc:
            print(f"[rag] ANN 检索失败，改用暴力: {exc}")
            vec_rank = self._brute_force(vec, k * 2)

        bm25_rank = self.bm25.search(query, k * 2)

        # RRF 融合
        rrf: dict[int, float] = {}
        for rank, idx in enumerate(vec_rank, start=1):
            if idx is not None:
                rrf[idx] = rrf.get(idx, 0.0) + 1.0 / (RRF_K + rank)
        for rank, idx in enumerate(bm25_rank, start=1):
            rrf[idx] = rrf.get(idx, 0.0) + 1.0 / (RRF_K + rank)
        if not rrf:
            return []

        fused = sorted(rrf.items(), key=lambda kv: kv[1], reverse=True)[:k]
        return [
            Hit(
                score=score,
                text=str(self.rows[idx]["text"]),
                title=str(self.rows[idx]["title"]),
                source=str(self.rows[idx]["source"]),
                url=str(self.rows[idx]["url"]),
                category=str(self.rows[idx]["category"]),
                chunk_index=int(self.rows[idx]["chunk_index"]),
            )
            for idx, score in fused
        ]

    def _brute_force(self, vec: list[float], k: int) -> list[int]:
        """余弦相似度暴力 top-k（不依赖 lance 表对象）。"""
        def cos(a: list[float], b: list[float]) -> float:
            dot = sum(x * y for x, y in zip(a, b))
            na = math.sqrt(sum(x * x for x in a))
            nb = math.sqrt(sum(x * x for x in b))
            return dot / (na * nb) if na and nb else 0.0

        scored = [
            (i, cos(vec, list(r["vector"])))
            for i, r in enumerate(self.rows)
        ]
        scored.sort(key=lambda t: t[1], reverse=True)
        return [i for i, s in scored if s > 0][:k]

    def _row_index(self, row_id: str) -> int | None:
        for i, r in enumerate(self.rows):
            if r["id"] == row_id:
                return i
        return None


_retriever: Retriever | None = None
_retriever_failed = False


def get_retriever() -> Retriever | None:
    """进程级单例；索引缺失/初始化失败返回 None（调用方降级无 RAG）。"""
    global _retriever, _retriever_failed
    if _retriever is not None:
        return _retriever
    if _retriever_failed:
        return None
    try:
        _retriever = Retriever()
    except Exception as exc:  # 索引缺失等
        print(f"[rag] 检索器不可用: {exc}")
        _retriever_failed = True
    return _retriever


def invalidate_retriever() -> None:
    """失效进程级检索单例（知识库 PUT/重建后调用）。

    置 _retriever 为 None，下次 get_retriever() 重建（内存 BM25 索引随之刷新）；
    同时清除失败标记，使「索引缺失后重建成功」的场景可以恢复。
    """
    global _retriever, _retriever_failed
    _retriever = None
    _retriever_failed = False


def retrieve(query: str, top_k: int | None = None) -> list[Hit]:
    r = get_retriever()
    return r.retrieve(query, top_k) if r else []
