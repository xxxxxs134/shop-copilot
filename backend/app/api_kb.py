"""
轻量知识库管理 API（P5 §4.1）：文档/切片查看与编辑、单块重嵌入、一键重建。

端点：
  GET  /v1/kb/docs            文档列表：[{id,title,category,source,chunk_count}]（从 LanceDB 索引聚合）
  GET  /v1/kb/chunks?doc=     切片列表：[{id,doc_id,chunk_index,text}]
  PUT  /v1/kb/chunks/{id}     {text} → 重嵌入该块 → 更新 LanceDB 行 → 失效检索单例
  POST /v1/kb/rebuild         全量重建（复用 pipeline.build()），返回耗时与块数

约定：
- 错误响应统一走 RFC 9457 problem+json（见 backend/app/errors.py），绝不裸抛 traceback、不泄漏内部命令。
- 行更新优先 table.update()（lancedb 0.40 实测支持向量列）。
- 集成协议（P5 §7）：本文件不改 main.py，由整合者统一 include_router(router)。
"""

from __future__ import annotations

import logging
import os
import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .errors import Problem
from .rag import pipeline
from .rag.pipeline import INDEX_ROOT, get_embedder
from .rag.retrieve import get_retriever, invalidate_retriever

logger = logging.getLogger("shop-copilot.api_kb")

router = APIRouter()

_TITLE = {400: "请求格式有误", 404: "未找到", 500: "知识库服务异常"}
_CODE = {400: "INVALID_INPUT", 404: "NOT_FOUND", 500: "KB_INTERNAL"}


def _err(status: int, detail: str, exc: Exception | None = None) -> JSONResponse:
    """统一错误响应体（RFC 9457 problem+json）；技术细节只进日志，不泄漏给用户。"""
    if exc is not None:
        logger.warning("kb 错误: %s -> %s", detail, exc)
    return Problem(
        title=_TITLE.get(status, "请求失败"),
        status=status,
        detail=detail,
        code=_CODE.get(status, f"HTTP_{status}"),
        retryable=status in (429, 500, 502, 503, 504),
    ).response()


def _open_table():
    """打开当前 provider 的 chunks 表；索引缺失返回 None（调用方转 404）。"""
    import lancedb

    provider = os.getenv("EMBED_PROVIDER", "local")
    index_dir = INDEX_ROOT / provider
    if not (index_dir / "chunks.lance").exists():
        return None
    return lancedb.connect(str(index_dir)).open_table("chunks")


def _read_rows(table) -> list[dict]:
    """全表读出为 dict 列表（种子规模 ≈百级块，可接受）。"""
    return table.to_pandas().to_dict("records")


class ChunkUpdateBody(BaseModel):
    text: str


@router.get("/v1/kb/docs")
def kb_docs() -> list[dict]:
    """文档列表：按 doc_id 聚合索引行，返回 id/title/category/source/chunk_count。"""
    table = _open_table()
    if table is None:
        return _err(404, "知识库索引尚未构建，请先在知识库页完成索引构建")
    docs: list[dict] = []
    seen: dict[str, int] = {}
    for row in _read_rows(table):
        doc_id = str(row["doc_id"])
        if doc_id not in seen:
            seen[doc_id] = len(docs)
            docs.append(
                {
                    "id": doc_id,
                    "title": str(row["title"]),
                    "category": str(row["category"]),
                    "source": str(row["source"]),
                    "chunk_count": 0,
                }
            )
        docs[seen[doc_id]]["chunk_count"] += 1
    return docs


@router.get("/v1/kb/chunks")
def kb_chunks(doc: str | None = None) -> list[dict]:
    """某文档的切片列表（chunk_index 升序）；缺 doc 参数 400，未知文档 404。"""
    if not (doc or "").strip():
        return _err(400, "缺少查询参数 doc（文档 id）")
    table = _open_table()
    if table is None:
        return _err(404, "知识库索引尚未构建，请先在知识库页完成索引构建")
    chunks = [
        {
            "id": str(row["id"]),
            "doc_id": str(row["doc_id"]),
            "chunk_index": int(row["chunk_index"]),
            "text": str(row["text"]),
        }
        for row in _read_rows(table)
        if str(row["doc_id"]) == doc
    ]
    if not chunks:
        return _err(404, f"文档不存在或无切片: {doc}")
    chunks.sort(key=lambda c: c["chunk_index"])
    return chunks


@router.put("/v1/kb/chunks/{chunk_id}")
def kb_chunk_update(chunk_id: str, body: ChunkUpdateBody) -> dict:
    """编辑切片：重嵌入新文本 → 更新 LanceDB 行 → 失效检索单例（BM25 随下次构建刷新）。"""
    text = body.text.strip()
    if not text:
        return _err(400, "text 不能为空")
    # 防注入：LanceDB update 的 where 是拼接 SQL，chunk_id 来自 URL，先拦引号/反斜杠
    if not chunk_id or any(ch in chunk_id for ch in ("'", '"', ";", "\\", "\0")):
        return _err(400, "非法切片 ID")
    table = _open_table()
    if table is None:
        return _err(404, "知识库索引尚未构建，请先在知识库页完成索引构建")
    if not any(str(row["id"]) == chunk_id for row in _read_rows(table)):
        return _err(404, f"切片不存在: {chunk_id}")

    # 重嵌入：优先复用检索单例已懒加载的模型，避免每次编辑重复拉起
    retriever = get_retriever()
    embedder = retriever.embedder if retriever is not None else get_embedder()
    try:
        vector = [float(x) for x in embedder.embed([text])[0]]
    except Exception as exc:
        return _err(500, "切片保存失败，请稍后重试", exc)

    # 行更新：优先 table.update()（lancedb 0.40 支持向量列；id 含 # 但无引号，转义单引号即可）
    where = "id = '" + chunk_id.replace("'", "''") + "'"
    try:
        table.update(where=where, values={"text": text, "vector": vector})
    except Exception as exc:
        return _err(500, "切片保存失败，请稍后重试", exc)

    invalidate_retriever()
    return {"ok": True, "id": chunk_id}


@router.post("/v1/kb/rebuild")
def kb_rebuild() -> dict:
    """全量重建索引（复用 pipeline.build()），返回耗时秒数与块数，并失效检索单例。"""
    started = time.perf_counter()
    try:
        code = pipeline.build()
    except Exception as exc:
        return _err(500, "索引重建失败，请稍后重试", exc)
    elapsed = time.perf_counter() - started
    if code != 0:
        return _err(500, "索引重建失败：未找到知识库语料")
    invalidate_retriever()
    table = _open_table()
    chunk_count = table.count_rows() if table is not None else 0
    return {"ok": True, "elapsed_seconds": round(elapsed, 2), "chunk_count": chunk_count}
