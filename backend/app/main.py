"""
店智 Copilot — Python AI 接入层（FastAPI）

定位（对应比赛规则「后端服务仅作为AI能力的接入层」）：
- 对前端暴露 OpenAI 兼容接口 /v1/chat/completions，流式中转 DeepSeek
- 后续里程碑的 RAG 检索、Agent 工具、MCP、视觉模型全部挂在这一层

运行（必须在项目根目录执行，backend 是 Python 包）：
  pip install -r backend/requirements.txt
  cp backend/.env.example backend/.env     # 填入 DEEPSEEK_API_KEY
  python -m backend.app.rag.pipeline build  # 首次：构建知识库索引
  uvicorn backend.app.main:app --port 8000
"""

import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from .rag.retrieve import retrieve
from .agent.loop import run_agent
from . import store
from .api_intent import router as intent_router
from .api_kb import router as kb_router
from .api_workspace import router as workspace_router
from .api_data import router as data_router
from .api_refund import router as refund_router
from .api_escalation import router as escalation_router

# 读取 backend/.env 中的密钥（不进 git）
load_dotenv(Path(__file__).parent.parent / ".env")

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
RAG_ENABLED = os.getenv("RAG_ENABLED", "true").lower() not in ("0", "false", "no")


def _last_user_text(messages: list) -> str | None:
    """取最后一条 user 消息的纯文本（兼容 str 与 parts 两种 content 形态）。"""
    for msg in reversed(messages):
        if not isinstance(msg, dict) or msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            return content
        if isinstance(content, list):
            parts = [
                str(p.get("text", ""))
                for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            ]
            text = "".join(parts).strip()
            if text:
                return text
    return None


def _build_rag_system(hits) -> str:
    """把检索命中拼成带编号的 system 上下文（C11 引用可溯源）。"""
    lines = ["以下是内部知识库的检索结果，仅用于参考回答："]
    for i, h in enumerate(hits, 1):
        lines.append(
            f"[{i}] 《{h.title}》（分类：{h.category}，来源：{h.source or '知识库'}）\n{h.text}"
        )
    lines.append(
        "要求：引用依据时在句末标注 [1][2] 形式的角标；"
        "如果检索结果不足以回答问题，请明确说明“知识库未覆盖”，不要编造。"
    )
    return "\n\n".join(lines)

app = FastAPI(title="店智 Copilot AI 接入层", version="0.1.0")

# 允许本地 Next.js 开发服务器跨域调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# P5 集成：意图分流 + 轻量知识库管理（docs/plan-p5.md §7，仅整合者改此处）
app.include_router(intent_router)
app.include_router(kb_router)
app.include_router(workspace_router)
app.include_router(data_router)
app.include_router(refund_router)
app.include_router(escalation_router)


@app.get("/health")
async def health() -> dict:
    """健康检查：前端/部署探活用"""
    return {"status": "ok", "deepseek_key_configured": bool(DEEPSEEK_API_KEY)}


# ────────────────────────────── 会话持久化（P4 §3.1） ──────────────────────────────

class SessionCreateBody(BaseModel):
    title: str | None = None
    mode: str = "rag"


class SessionPatchBody(BaseModel):
    title: str | None = None
    mode: str | None = None  # 空会话切换 RAG/Agent 模式


class SessionMessagesBody(BaseModel):
    messages: list
    title: str | None = None  # 首条消息时前端顺带传自动命名


def _session_or_404(sid: str) -> dict:
    sess = store.get_session(sid)
    if sess is None:
        raise _Http404("会话不存在")
    return sess


class _Http404(Exception):
    def __init__(self, message: str):
        self.message = message


@app.exception_handler(_Http404)
async def _http404_handler(_request: Request, exc: _Http404) -> JSONResponse:
    return JSONResponse(status_code=404, content={"error": {"message": exc.message}})


@app.get("/v1/sessions")
async def sessions_list() -> list[dict]:
    """会话元数据列表（updated_at 降序）。"""
    return store.list_sessions()


@app.post("/v1/sessions", status_code=201)
async def sessions_create(body: SessionCreateBody) -> dict:
    if body.mode not in store.VALID_MODES:
        return JSONResponse(status_code=400, content={"error": {"message": f"mode 必须是 {store.VALID_MODES}"}})
    title = (body.title or "").strip() or "新对话"
    return store.create_session(title, body.mode)


@app.get("/v1/sessions/{sid}")
async def sessions_get(sid: str) -> dict:
    return _session_or_404(sid)


@app.patch("/v1/sessions/{sid}")
async def sessions_patch(sid: str, body: SessionPatchBody) -> dict:
    _session_or_404(sid)
    if body.title is None and body.mode is None:
        return JSONResponse(status_code=400, content={"error": {"message": "title 或 mode 至少提供一个"}})
    if body.mode is not None and body.mode not in store.VALID_MODES:
        return JSONResponse(status_code=400, content={"error": {"message": f"mode 必须是 {store.VALID_MODES}"}})
    if body.title is not None and not body.title.strip():
        return JSONResponse(status_code=400, content={"error": {"message": "title 不能为空"}})
    store.patch_session(sid, title=body.title, mode=body.mode)
    return {"ok": True}


@app.delete("/v1/sessions/{sid}")
async def sessions_delete(sid: str) -> dict:
    _session_or_404(sid)
    store.delete_session(sid)
    return {"ok": True}


@app.put("/v1/sessions/{sid}/messages")
async def sessions_put_messages(sid: str, body: SessionMessagesBody) -> dict:
    _session_or_404(sid)
    store.put_messages(sid, body.messages, title=body.title)
    return {"ok": True}


# ────────────────────────────── 引用溯源（P4 §3.2） ──────────────────────────────

@app.get("/v1/rag/search")
async def rag_search(q: str, k: int = 4) -> list[dict]:
    """与生成端同管线的检索结果（同编号）——前端点 [n] 角标取第 n 项弹溯源卡片。"""
    hits = retrieve(q, top_k=max(1, min(k, 8)))
    return [
        {
            "title": h.title,
            "category": h.category,
            "source": h.source,
            "url": h.url,
            "text": h.text,
        }
        for h in hits
    ]


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    """
    OpenAI 兼容的流式聊天中转。

    策略：
    - 前端发来的请求体透传（强制 stream=true），额外做 RAG 检索注入
    - RAG：命中知识库时前置 system 上下文（带 [1][2] 编号）；body.rag=false 可关闭
    - 上游非 200 时返回 JSON 错误（带中文说明），便于前端优雅展示
    """
    if not DEEPSEEK_API_KEY:
        return JSONResponse(
            status_code=400,
            content={"error": {"message": "缺少 DEEPSEEK_API_KEY，请在 backend/.env 配置后重启后端"}},
        )

    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": {"message": "请求体不是合法 JSON"}})

    payload["stream"] = True  # 前端 useChat 依赖流式
    # 接入层兜底模型名（前端可不传，传了则以调用方为准）
    payload.setdefault("model", os.getenv("DEEPSEEK_MODEL", "deepseek-chat"))

    rag_flag = bool(payload.pop("rag", RAG_ENABLED))
    messages = payload.get("messages")
    if rag_flag and isinstance(messages, list):
        query = _last_user_text(messages)
        if query:
            hits = retrieve(query)  # 索引缺失时内部降级为 []
            if hits:
                payload["messages"] = [{"role": "system", "content": _build_rag_system(hits)}] + messages

    client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))
    try:
        upstream_request = client.build_request(
            "POST",
            f"{DEEPSEEK_BASE_URL}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
        )
        # stream=True：先拿响应头即可判断成败，不必等整个 body
        upstream = await client.send(upstream_request, stream=True)

        if upstream.status_code != 200:
            body = (await upstream.aread()).decode("utf-8", "replace")
            await upstream.aclose()
            await client.aclose()
            return JSONResponse(
                status_code=upstream.status_code,
                content={"error": {"message": f"DeepSeek 返回错误: {body[:500]}"}},
            )

        async def relay():
            """把 DeepSeek 的 SSE 字节流原样转发给前端"""
            try:
                async for chunk in upstream.aiter_bytes():
                    yield chunk
            finally:
                await upstream.aclose()
                await client.aclose()

        return StreamingResponse(
            relay(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    except httpx.HTTPError as exc:
        await client.aclose()
        return JSONResponse(
            status_code=502,
            content={"error": {"message": f"连接 DeepSeek 失败: {exc}"}},
        )


@app.post("/v1/agent/chat")
async def agent_chat(request: Request):
    """
    Agent 模式 SSE 端点（P1）。

    事件协议（SSE data 字段的 JSON）：
      {"type":"step","tool":"...","args":{...}}            — 工具开始
      {"type":"step_result","tool":"...","summary":"..."}  — 工具结果摘要
      {"type":"delta","text":"..."}                        — 流式文本片段
      {"type":"done","citations":[...]}                    — 结束
      {"type":"error","message":"..."}                     — 错误
    """
    if not DEEPSEEK_API_KEY:
        return JSONResponse(
            status_code=400,
            content={"error": {"message": "缺少 DEEPSEEK_API_KEY，请在 backend/.env 配置后重启后端"}},
        )

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": {"message": "请求体不是合法 JSON"}})

    user_text = (body.get("message") or "").strip()
    if not user_text:
        return JSONResponse(status_code=400, content={"error": {"message": "message 不能为空"}})

    history = body.get("history") or []

    async def event_stream():
        try:
            async for event in run_agent(user_text, history):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001 — 兜底，不让 SSE 中断
            err = {"type": "error", "message": f"Agent 内部错误: {exc}"}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ────────────────────────────── 多模态：图生文案 ──────────────────────────────

VISION_MODEL = os.getenv("VISION_MODEL", "glm-4v-flash")
VISION_BASE_URL = os.getenv("VISION_BASE_URL", "https://open.bigmodel.cn/api/paas/v4")
VISION_API_KEY = os.getenv("VISION_API_KEY", "")


@app.post("/v1/vision/caption")
async def vision_caption(request: Request):
    """
    商品图 → 文案（GLM-4V 视觉模型）。

    请求体（二选一）：
      {"image_url": "https://..."}          — 远程图片 URL
      {"image_base64": "<base64 without prefix>"}  — 本地图片 base64

    响应：
      {"title": "...", "selling_points": ["...", "..."], "description": "..."}
    """
    if not VISION_API_KEY:
        return JSONResponse(
            status_code=400,
            content={"error": {"message": "缺少 VISION_API_KEY（智谱 GLM-4V），请在 backend/.env 配置后重启后端"}},
        )

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": {"message": "请求体不是合法 JSON"}})

    image_url = body.get("image_url")
    image_b64 = body.get("image_base64")
    if not image_url and not image_b64:
        return JSONResponse(status_code=400, content={"error": {"message": "需要 image_url 或 image_base64"}})

    # 构造 GLM-4V 消息（OpenAI 兼容格式）
    if image_url:
        image_content = {"type": "image_url", "image_url": {"url": image_url}}
    else:
        image_content = {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}}

    payload = {
        "model": VISION_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    image_content,
                    {
                        "type": "text",
                        "text": "你是电商文案专家。根据这张商品图，生成：1) 商品标题（30字内，含核心卖点）；"
                                "2) 3-5个卖点列表；3) 一句话短描述。用 JSON 格式返回，字段：title, selling_points, description。",
                    },
                ],
            }
        ],
        "temperature": 0.7,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        try:
            resp = await client.post(
                f"{VISION_BASE_URL}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {VISION_API_KEY}"},
            )
        except httpx.HTTPError as exc:
            return JSONResponse(status_code=502, content={"error": {"message": f"连接视觉模型失败: {exc}"}})

    if resp.status_code != 200:
        return JSONResponse(
            status_code=resp.status_code,
            content={"error": {"message": f"视觉模型返回 {resp.status_code}: {resp.text[:300]}"}},
        )

    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    # 尝试解析 JSON（GLM-4V 可能包 ```json ... ```）
    import json as _json
    import re
    m = re.search(r"\{.*\}", content, re.DOTALL)
    if m:
        try:
            parsed = _json.loads(m.group(0))
            return parsed
        except _json.JSONDecodeError:
            pass
    # 解析失败时返回原文
    return {"raw": content}
