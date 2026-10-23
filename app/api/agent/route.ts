/**
 * Agent 模式 API 路由（Next.js → FastAPI 透传）
 *
 * 职责：
 * - 接收前端 POST { message, history }
 * - 转发到 Python FastAPI /v1/agent/chat（http://127.0.0.1:8000）
 * - 将 FastAPI 的 SSE 响应原样流回前端
 *
 * 错误处理：
 * - FastAPI 未启动 / 网络错误 → 返回 502 JSON
 * - 请求体非法 → 400
 */

const FASTAPI_BASE = process.env.FASTAPI_BASE_URL ?? 'http://127.0.0.1:8000';

export async function POST(req: Request) {
  let body: { message?: string; history?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  if (!body.message?.trim()) {
    return Response.json({ error: 'message 不能为空' }, { status: 400 });
  }

  const payload = {
    message: body.message,
    history: Array.isArray(body.history) ? body.history : [],
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${FASTAPI_BASE}/v1/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return Response.json(
      { error: `无法连接 Python AI 层（${FASTAPI_BASE}）: ${msg}。请先运行 uvicorn backend.app.main:app --port 8000` },
      { status: 502 },
    );
  }

  // 上游非 200：读取错误体透传
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return new Response(text || upstream.statusText, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // SSE 透传
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
