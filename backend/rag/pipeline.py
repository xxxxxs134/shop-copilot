"""
RAG 索引管线：加载 → 清洗 → 分块 → 嵌入 → LanceDB

用法（项目根目录执行）：
  python -m backend.rag.pipeline build     # 全量重建索引（C8 可复现）
  python -m backend.rag.pipeline stats     # 查看索引统计

环境变量：
  EMBED_PROVIDER=local|siliconflow   默认 local（fastembed BGE-small-zh，零密钥）
  SILICONFLOW_API_KEY=...            仅 siliconflow 提供方需要（BGE-M3 升级路径）

分块参数：目标 800 字符/块、200 字符重叠（中文 ≈1.6 字符/token，对应约 512/128 token）。
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = PROJECT_ROOT / "data" / "raw"
INDEX_ROOT = PROJECT_ROOT / "data" / "index"

TARGET_CHARS = 800   # ≈512 token（中文）
OVERLAP_CHARS = 200  # ≈128 token
EMBED_BATCH = 32


@dataclass
class Doc:
    doc_id: str
    path: str
    title: str
    source: str
    url: str
    category: str
    body: str


@dataclass
class Chunk:
    doc_id: str
    chunk_index: int
    title: str
    source: str
    url: str
    category: str
    text: str


def parse_frontmatter(raw: str) -> tuple[dict[str, str], str]:
    """解析 YAML frontmatter（仅支持 title/source/url/category 平铺键，无嵌套）。"""
    m = re.match(r"\A---\s*\n(.*?)\n---\s*\n?(.*)\Z", raw, re.DOTALL)
    if not m:
        return {}, raw
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith((" ", "\t")):
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
    return meta, m.group(2)


def clean_text(text: str) -> str:
    """清洗：去多余空白、统一换行。"""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def load_docs(raw_dir: Path = RAW_DIR) -> list[Doc]:
    """加载 data/raw/*.md，frontmatter 缺 title 的文件跳过并告警。"""
    docs: list[Doc] = []
    files = sorted(raw_dir.glob("*.md"))
    for path in files:
        meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
        title = meta.get("title", "").strip()
        if not title:
            print(f"[warn] 缺 title，跳过: {path.name}", file=sys.stderr)
            continue
        body = clean_text(body)
        if not body:
            continue
        docs.append(
            Doc(
                doc_id=path.stem,
                path=str(path.relative_to(PROJECT_ROOT)),
                title=title,
                source=meta.get("source", ""),
                url=meta.get("url", ""),
                category=meta.get("category", "未分类"),
                body=body,
            )
        )
    return docs


def chunk_doc(doc: Doc) -> list[Chunk]:
    """按段落累积分块：≤800 字符/块，块尾 200 字符与下一块重叠。"""
    paragraphs = [p for p in doc.body.split("\n") if p.strip()]
    chunks: list[Chunk] = []
    current = ""

    def flush(text: str) -> None:
        text = text.strip()
        if text:
            chunks.append(
                Chunk(
                    doc_id=doc.doc_id,
                    chunk_index=len(chunks),
                    title=doc.title,
                    source=doc.source,
                    url=doc.url,
                    category=doc.category,
                    text=text,
                )
            )

    for para in paragraphs:
        candidate = f"{current}\n{para}".strip() if current else para
        if len(candidate) <= TARGET_CHARS:
            current = candidate
            continue
        flush(current)
        # 重叠：取上一块尾部 OVERLAP_CHARS 作为新块开头
        overlap = current[-OVERLAP_CHARS:]
        current = f"{overlap}{para}"
        if len(current) > TARGET_CHARS * 1.5:
            # 单段超长：硬切
            for i in range(0, len(current), TARGET_CHARS):
                flush(current[i : i + TARGET_CHARS])
            current = ""
    flush(current)
    return chunks


class LocalEmbedder:
    """fastembed 本地嵌入（BAAI/bge-small-zh-v1.5，512 维，零密钥）。"""

    name = "local"

    def __init__(self) -> None:
        # 国内网络直连 huggingface.co 超时，默认走 hf-mirror 镜像（可用 HF_ENDPOINT 覆盖）
        os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
        from fastembed import TextEmbedding

        self._model = TextEmbedding(model_name="BAAI/bge-small-zh-v1.5")

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [list(map(float, v)) for v in self._model.embed(texts)]


class SiliconFlowEmbedder:
    """SiliconFlow BGE-M3（1024 维）：设 EMBED_PROVIDER=siliconflow 时启用。"""

    name = "siliconflow"

    def __init__(self) -> None:
        self._key = os.getenv("SILICONFLOW_API_KEY", "")
        if not self._key:
            raise RuntimeError("EMBED_PROVIDER=siliconflow 需要 SILICONFLOW_API_KEY")

    def embed(self, texts: list[str]) -> list[list[float]]:
        import httpx

        vectors: list[list[float]] = []
        for i in range(0, len(texts), EMBED_BATCH):
            batch = texts[i : i + EMBED_BATCH]
            resp = httpx.post(
                "https://api.siliconflow.cn/v1/embeddings",
                headers={"Authorization": f"Bearer {self._key}"},
                json={"model": "BAAI/bge-m3", "input": batch},
                timeout=60,
            )
            resp.raise_for_status()
            data = sorted(resp.json()["data"], key=lambda d: d["index"])
            vectors.extend(item["embedding"] for item in data)
        return vectors


def get_embedder():
    provider = os.getenv("EMBED_PROVIDER", "local")
    if provider == "local":
        return LocalEmbedder()
    if provider == "siliconflow":
        return SiliconFlowEmbedder()
    raise ValueError(f"未知 EMBED_PROVIDER: {provider}")


def build() -> int:
    """全量重建索引，写入 data/index/{provider}/chunks 表（C8）。"""
    docs = load_docs()
    if not docs:
        print(f"[error] 未找到语料: {RAW_DIR}", file=sys.stderr)
        return 1
    chunks = [c for doc in docs for c in chunk_doc(doc)]
    print(f"语料: {len(docs)} 篇 → 分块: {len(chunks)} 块")

    embedder = get_embedder()
    print(f"嵌入: provider={embedder.name} ...")
    vectors: list[list[float]] = []
    for i in range(0, len(chunks), EMBED_BATCH):
        batch = [c.text for c in chunks[i : i + EMBED_BATCH]]
        vectors.extend(embedder.embed(batch))
        print(f"  {min(i + EMBED_BATCH, len(chunks))}/{len(chunks)}")

    records = [
        {
            "id": f"{c.doc_id}#{c.chunk_index}",
            "doc_id": c.doc_id,
            "chunk_index": c.chunk_index,
            "title": c.title,
            "source": c.source,
            "url": c.url,
            "category": c.category,
            "text": c.text,
            "vector": vectors[i],
        }
        for i, c in enumerate(chunks)
    ]

    import lancedb

    index_dir = INDEX_ROOT / embedder.name
    index_dir.mkdir(parents=True, exist_ok=True)
    db = lancedb.connect(str(index_dir))
    db.create_table("chunks", data=records, mode="overwrite")
    print(f"索引已写入: {index_dir / 'chunks'}（{len(records)} 块，dim={len(vectors[0])}）")
    return 0


def stats() -> int:
    provider = os.getenv("EMBED_PROVIDER", "local")
    index_dir = INDEX_ROOT / provider
    if not (index_dir / "chunks.lance").exists():
        print(f"[error] 索引不存在: {index_dir}（先执行 build）", file=sys.stderr)
        return 1
    import lancedb

    table = lancedb.connect(str(index_dir)).open_table("chunks")
    print(f"provider={provider}  rows={table.count_rows()}")
    return 0


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "build":
        return build()
    if cmd == "stats":
        return stats()
    print(f"用法: python -m backend.rag.pipeline [build|stats]（未知命令: {cmd}）", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
