/**
 * `/api/v1/*` catch-all 代理 → Python FastAPI（BACKEND_URL ?? http://127.0.0.1:8000）
 *
 * 目的：会话管理（/v1/sessions）与引用溯源（/v1/rag/search）等「非流式」API
 * 统一走 Next.js 代理，与现有 /api/chat、/api/agent 代理模式保持一致：
 * 浏览器只和同源 3000 通信，避免直连 8000 的 CORS 与地址配置问题。
 *
 * 透传规则：请求体/查询串/状态码原样转发，仅替换路径前缀 /api/v1 → /v1。
 */

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:8000';

async function proxy(req: Request, path: string[]): Promise<Response> {
  const url = new URL(req.url);
  const target = `${BACKEND_URL}/v1/${path.map(encodeURIComponent).join('/')}${url.search}`;

  let body: string | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await req.text();
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        // 代理内部为服务端请求，Content-Type 仅在有体时透传
        ...(body ? { 'Content-Type': req.headers.get('content-type') ?? 'application/json' } : {}),
      },
      body,
      cache: 'no-store',
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    return Response.json(
      { error: { message: `AI 接入层（${BACKEND_URL}）不可达：${message}` } },
      { status: 502 },
    );
  }
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function POST(req: Request, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PUT(req: Request, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
