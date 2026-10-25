/**
 * 意图识别客户端（P5 §2.1 / §2.2）
 *
 * 契约（docs/plan-p5.md §2.1）：
 *   POST /api/v1/intent   {"q": "用户问题"}
 *   → {"intent": "knowledge|data|policy|copywriting|general",
 *      "target": "rag|agent",
 *      "reason": "一句话理由（供 chip 展示）"}
 *
 * 走既有 /api/v1/* 同源代理（app/api/v1/[...path]/route.ts 透传 → FastAPI /v1/intent），
 * 本文件不新增任何代理代码。
 *
 * 失败语义：网络错误 / 非 200 / 非 JSON / 字段缺失一律返回 null ——
 * 意图识别只是增强信息，绝不允许它阻断或拖垮发送主链路（调用方按 null 跳过 chip 与自动路由）。
 */

import type { UIMessage } from 'ai';

/** /v1/intent 原始响应（三字段契约） */
export interface IntentResponse {
  intent: string;
  target: string;
  reason: string;
}

/**
 * 消息上持久化的意图字段 = 响应三字段 + 前端追加的 `switched` 标记。
 *
 * `switched` 仅在「RAG 模式按意图自动切到 Agent」时由前端写入，
 * 用于 chip 后缀「已按意图切换」；老数据无此字段 → 不渲染后缀（向后兼容）。
 */
export interface IntentInfo extends IntentResponse {
  switched?: boolean;
}

/**
 * RAG 模式 UIMessage 的意图扩展。
 * AI SDK 的 UIMessage 无 `intent` 字段，用交叉类型读写，避免 as any。
 */
export type IntentUIMessage = UIMessage & { intent?: IntentInfo };

/**
 * §2.2 非对称路由表：仅这三类意图在 RAG 模式下自动切到 Agent。
 * knowledge / general 留在 RAG；Agent 模式一律不回切（调用方不判路由）。
 */
const AUTO_SWITCH_INTENTS: ReadonlySet<string> = new Set(['data', 'policy', 'copywriting']);

/** 当前处于 RAG 模式时，该意图是否需要自动切到 Agent（§2.2 路由表） */
export function shouldAutoSwitch(intent: string): boolean {
  return AUTO_SWITCH_INTENTS.has(intent);
}

/** 响应体校验：三个字段必须均为 string，否则视为识别失败 */
function parseIntent(data: unknown): IntentResponse | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (
    typeof d.intent !== 'string' ||
    typeof d.target !== 'string' ||
    typeof d.reason !== 'string'
  ) {
    return null;
  }
  return { intent: d.intent, target: d.target, reason: d.reason };
}

/** 超时兜底：后端契约目标 <1.5s，5s 仍未返回按失败处理（不拖住发送链路） */
const INTENT_TIMEOUT_MS = 5000;

/**
 * 识别单条问题的意图。**永不抛出**：任何失败路径都返回 null。
 *
 * 与回答请求并行发起（不 await 在 sendMessage 之前），故不阻塞首 token。
 */
export async function fetchIntent(q: string): Promise<IntentResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTENT_TIMEOUT_MS);
  try {
    const res = await fetch('/api/v1/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q }),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return parseIntent(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
