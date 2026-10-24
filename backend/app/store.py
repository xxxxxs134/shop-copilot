"""会话持久化存储 — SQLite（Python stdlib，零额外依赖）。

契约见 docs/plan-p4.md §3.1：
- messages 以 JSON 数组原样存取（前端消息结构，后端不解释语义）
- 列表端点只回元数据（不含 messages，列表轻量）
- PATCH 支持 title 与 mode 局部更新
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "app.db"
VALID_MODES = ("rag", "agent")


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.isolation_level = None  # autocommit：单机 demo 场景，省去显式 commit
    conn.row_factory = sqlite3.Row
    conn.execute(
        """CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            mode TEXT NOT NULL,
            messages TEXT NOT NULL DEFAULT '[]',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        )"""
    )
    return conn


def _full_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "mode": row["mode"],
        "messages": json.loads(row["messages"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_sessions() -> list[dict]:
    """元数据列表，updated_at 降序（最近会话置顶）。"""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, title, mode, updated_at FROM sessions ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def create_session(title: str, mode: str) -> dict:
    sid = uuid.uuid4().hex[:12]
    now = time.time()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO sessions (id, title, mode, messages, created_at, updated_at)"
            " VALUES (?, ?, ?, '[]', ?, ?)",
            (sid, title, mode, now, now),
        )
    return get_session(sid)  # type: ignore[return-value]


def get_session(sid: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE id = ?", (sid,)).fetchone()
        return _full_row(row) if row else None


def patch_session(sid: str, title: str | None = None, mode: str | None = None) -> bool:
    sets: list[str] = []
    params: list = []
    if title is not None:
        sets.append("title = ?")
        params.append(title)
    if mode is not None:
        sets.append("mode = ?")
        params.append(mode)
    if not sets:
        return False
    sets.append("updated_at = ?")
    params.extend([time.time(), sid])
    with _connect() as conn:
        cur = conn.execute(f"UPDATE sessions SET {', '.join(sets)} WHERE id = ?", params)
        return cur.rowcount > 0


def delete_session(sid: str) -> bool:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM sessions WHERE id = ?", (sid,))
        return cur.rowcount > 0


def put_messages(sid: str, messages: list, title: str | None = None) -> bool:
    """全量覆盖消息（前端 debounce 后 PUT）。可顺带更新标题（首条消息自动命名）。"""
    payload = json.dumps(messages, ensure_ascii=False)
    with _connect() as conn:
        if title is not None:
            cur = conn.execute(
                "UPDATE sessions SET messages = ?, title = ?, updated_at = ? WHERE id = ?",
                (payload, title, time.time(), sid),
            )
        else:
            cur = conn.execute(
                "UPDATE sessions SET messages = ?, updated_at = ? WHERE id = ?",
                (payload, time.time(), sid),
            )
        return cur.rowcount > 0
