"""
店智 Copilot — Python AI 接入层（FastAPI）

定位（对应比赛规则「后端服务仅作为AI能力的接入层」）：
- 对前端暴露 OpenAI 兼容接口 /v1/chat/completions，流式中转 DeepSeek
- 后续里程碑的 RAG 检索、Agent 工具、MCP、视觉模型全部挂在这一层

运行：
  cd backend
  pip install -r requirements.txt
  copy .env.example .env   # 填入 DEEPSEEK_API_KEY
  uvicorn backend.main:app --port 8000   # 在项目根目录执行，或 python -m uvicorn main:app --port 8000（在 backend 目录内）
"""

import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

# 读取 backend/.env 中的密钥（不进 git）
load_dotenv(Path(__file__).parent / ".env")

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")

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
    - 前端 Vercel AI SDK 发来的请求体原样透传（强制 stream=true）
    - 本层不解析消息内容，只做密钥注入 + 流式字节转发（零额外延迟）
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
