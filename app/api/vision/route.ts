/**
 * Vision API 路由（Next.js → FastAPI 透传）
 *
 * 职责：
 * - 接收前端 POST { image_url } 或 { image_base64 }
 * - 转发到 Python FastAPI /v1/vision/caption
 * - 返回 GLM-4V 生成的 JSON（title / selling_points / description）
 */

const FASTAPI_BASE = process.env.FASTAPI_BASE_URL ?? 'http://127.0.0.1:8000';

export async function POST(req: Request) {
  let body: { image_url?: string; image_base64?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  if (!body.image_url && !body.image_base64) {
    return Response.json({ error: '需要 image_url 或 image_base64' }, { status: 400 });
  }

  const payload: Record<string, string> = {};
  if (body.image_url) payload.image_url = body.image_url;
  if (body.image_base64) payload.image_base64 = body.image_base64;

  let upstream: Response;
  try {
    upstream = await fetch(`${FASTAPI_BASE}/v1/vision/caption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return Response.json(
      { error: `无法连接 Python AI 层（${FASTAPI_BASE}）: ${msg}` },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
