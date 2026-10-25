/**
 * 会话管理 + 引用溯源客户端（走 /api/v1/* 同源代理 → FastAPI）
 *
 * 契约（docs/plan-p4.md §3.1 / §3.2）：
 *   GET    /v1/sessions                → SessionMeta[] 降序
 *   POST   /v1/sessions {title?,mode}  → SessionFull
 *   GET    /v1/sessions/{id}           → SessionFull
 *   PATCH  /v1/sessions/{id} {title?,mode?} → {ok:true}
 *   DELETE /v1/sessions/{id}           → {ok:true}
 *   PUT    /v1/sessions/{id}/messages {messages,title?} → {ok:true} 全量覆盖
 *   GET    /v1/rag/search?q=&k=4       → CitationSource[]（与生成端同序）
 *
 * 消息存前端原结构，客户端不解释语义：
 *   RAG  = UIMessage[]（AI SDK v5）
 *   Agent = {role,content,steps?}[]（见 AgentSteps）
 */

import type { UIMessage } from 'ai';
import type { AgentStep } from '@/components/AgentSteps';
import type { IntentInfo } from './intentClient';

export type SessionMode = 'rag' | 'agent';

/** 会话 id 为后端 uuid hex[:12]（TEXT 主键），非自增整数 */
export type SessionId = string;

export interface SessionMeta {
  id: SessionId;
  title: string;
  mode: SessionMode;
  /** epoch 秒（后端 time.time()） */
  updated_at: number;
}

export interface SessionFull extends SessionMeta {
  // 消息由前端原样写入/回放；具体结构取决于 mode，这里不做强约束
  messages: unknown[];
  /** epoch 秒 */
  created_at: number;
}

/** Agent 模式单条消息（与 ChatWindow 内部状态一致） */
export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  steps?: AgentStep[];
  /** 意图识别结果（P5 §2.2，仅 user 消息）；老会话无此字段 → 不渲染 chip */
  intent?: IntentInfo;
}

/** /v1/rag/search 返回体：第 n 项即回答中 [n] 角标的来源 */
export interface CitationSource {
  title: string;
  category: string;
  source?: string;
  text: string;
  url?: string;
}

interface ApiErrorBody {
  error?: { message?: string } | string;
  detail?: string | Array<{ msg: string }>;
  message?: string;
}

/** 统一解析 FastAPI 错误体为可展示文案 */
function parseError(body: ApiErrorBody | null, status: number): string {
  if (body) {
    if (typeof body.error === 'string') return body.error;
    if (body.error && typeof body.error.message === 'string') return body.error.message;
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail) && body.detail[0]) return body.detail[0].msg;
    if (typeof body.message === 'string') return body.message;
  }
  return `请求失败（HTTP ${status}）`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      cache: 'no-store',
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '网络错误';
    throw new Error(`无法连接服务（请确认后端已启动）：${message}`);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 非 JSON 响应（如 502 HTML），走状态码兜底
  }
  if (!res.ok) {
    throw new Error(parseError((body ?? null) as ApiErrorBody | null, res.status));
  }
  return body as T;
}

// ── 会话 CRUD ──

export function listSessions(): Promise<SessionMeta[]> {
  return request<SessionMeta[]>('/api/v1/sessions');
}

export function createSession(mode: SessionMode, title?: string): Promise<SessionFull> {
  return request<SessionFull>('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(title ? { mode, title } : { mode }),
  });
}

export function getSession(id: SessionId): Promise<SessionFull> {
  return request<SessionFull>(`/api/v1/sessions/${id}`);
}

export function patchSession(
  id: SessionId,
  patch: { title?: string; mode?: SessionMode },
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteSession(id: SessionId): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/sessions/${id}`, { method: 'DELETE' });
}

/**
 * 全量覆盖消息。title 仅当需要同步标题时传（首条消息自动生成标题场景）。
 * 消息结构原样透传，本层不做校验。
 */
export function putMessages(
  id: SessionId,
  messages: UIMessage[] | AgentMessage[],
  title?: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/sessions/${id}/messages`, {
    method: 'PUT',
    body: JSON.stringify(title ? { messages, title } : { messages }),
  });
}

// ── 引用溯源 ──

/**
 * 与生成端同一 retrieve()、同序返回 → 角标 [n] = sources[n-1]。
 * k 后端限 1..8，默认 4（与生成端一致）。
 */
export function ragSearch(q: string, k = 4): Promise<CitationSource[]> {
  return request<CitationSource[]>(`/api/v1/rag/search?q=${encodeURIComponent(q)}&k=${k}`);
}
