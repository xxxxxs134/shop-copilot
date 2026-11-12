/**
 * 统一错误解析（与 backend/app/errors.py 的 RFC 9457 problem+json 对齐）
 *
 * 背景：后端错误原先有四种形态混用，前端到处写 parseError 猜格式。
 * 现在后端统一返回 Problem 结构，本模块做「单一解析入口 + 兼容旧形态」。
 *
 * Problem 结构（backend 返回）：
 *   { type, title, status, detail, code, retryable, retry_after_ms, request_id, errors }
 *
 * 兼容旧形态（迁移期）：
 *   { error: { message } }          → 取 message
 *   { error: "字符串" }              → 取字符串
 *   { ok: false, error: "..." }     → 取 error
 *   { type: "error", error: {...} } → 取 error
 */

export interface FieldError {
  pointer: string;
  detail: string;
}

export interface Problem {
  type?: string;
  title: string;
  status?: number;
  detail?: string;
  code?: string;
  retryable: boolean;
  retry_after_ms?: number;
  request_id?: string;
  errors?: FieldError[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 面向用户的一句话错误文案：优先 detail，其次 title。 */
export function problemMessage(p: Problem): string {
  return p.detail?.trim() || p.title || '请求失败，请稍后重试';
}

export function isRetryable(p: Problem): boolean {
  return p.retryable === true;
}

/** 把任意响应体解析成统一 Problem（兼容新旧形态），永不抛异常。 */
export function parseProblem(input: unknown): Problem {
  if (typeof input === 'string') {
    try {
      return parseProblem(JSON.parse(input));
    } catch {
      return { title: '请求失败', detail: input || '请求失败，请稍后重试', retryable: false };
    }
  }
  if (!isRecord(input)) {
    return { title: '请求失败', detail: '请求失败，请稍后重试', retryable: false };
  }

  let obj: Record<string, unknown> = input;
  // 兼容旧形态：循环解包 { error: {...} } / { ok:false, error } / { type:"error", error }
  for (;;) {
    const err = obj.error;
    if (isRecord(err)) {
      obj = err;
      continue;
    }
    if (typeof err === 'string') {
      return { title: '请求失败', detail: err, retryable: false };
    }
    break;
  }

  return {
    type: typeof obj.type === 'string' ? obj.type : undefined,
    title: typeof obj.title === 'string' ? obj.title : '请求失败',
    status: typeof obj.status === 'number' ? obj.status : undefined,
    detail: typeof obj.detail === 'string' ? obj.detail : typeof obj.message === 'string' ? obj.message : undefined,
    code: typeof obj.code === 'string' ? obj.code : undefined,
    retryable: obj.retryable === true,
    retry_after_ms: typeof obj.retry_after_ms === 'number' ? obj.retry_after_ms : undefined,
    request_id: typeof obj.request_id === 'string' ? obj.request_id : undefined,
  };
}
