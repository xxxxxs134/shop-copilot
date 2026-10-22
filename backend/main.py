"""
店智 Copilot — Python AI 接入层（FastAPI）

定位（对应比赛规则「后端服务仅作为AI能力的接入层」）：
- 对前端暴露 OpenAI 兼容接口 /v1/chat/completions，流式中转 DeepSeek
- 后续里程碑的 RAG 检索、Agent 工具、MCP、视觉模型全部挂在这一层

运行（必须在项目根目录执行，backend 是 Python 包）：
  pip install -r backend/requirements.txt
  cp backend/.env.example backend/.env     # 填入 DEEPSEEK_API_KEY
  python -m backend.rag.pipeline build     # 首次：构建知识库索引
  uvicorn backend.main:app --port 8000
"""

import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .rag.retrieve import retrieve

# 读取 backend/.env 中的密钥（不进 git）
load_dotenv(Path(__file__).parent / ".env")

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


@app.get("/health")
async def health() -> dict:
    """健康检查：前端/部署探活用"""
    return {"status": "ok", "deepseek_key_configured": bool(DEEPSEEK_API_KEY)}


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
