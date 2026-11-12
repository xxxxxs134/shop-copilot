/**
 * Agent 模式 SSE 客户端
 *
 * 协议（与 backend/app/agent/loop.py 对齐）：
 *   data: {"type":"step","tool":"...","args":{...}}            — 工具开始
 *   data: {"type":"step_result","tool":"...","summary":"..."}  — 工具结果
 *   data: {"type":"delta","text":"..."}                        — 流式文本片段
 *   data: {"type":"done","citations":[...]}                    — 结束
 *   data: {"type":"error","message":"...","code":"...","retryable":bool}  — 错误（友好文案）
 */

import { parseProblem, problemMessage } from './errors';

export interface AgentStepEvent {
  type: 'step';
  tool: string;
  args: Record<string, unknown>;
}

export interface AgentStepResultEvent {
  type: 'step_result';
  tool: string;
  summary: string;
}

export interface AgentDeltaEvent {
  type: 'delta';
  text: string;
}

export interface ThoughtStep {
  agent: string;
  status?: string;
  input?: string;
  output?: string;
  detail?: string;
}

export interface AgentDoneEvent {
  type: 'done';
  citations: Array<{ title?: string; category?: string }>;
  thought_chain?: ThoughtStep[];
  /** 知识库命中（供 [n] 引用溯源 → CitationCard） */
  kb_hits?: Array<{ title: string; category: string; text: string }>;
}

export interface AgentErrorEvent {
  type: 'error';
  message: string;
  code?: string;
  retryable?: boolean;
}

export type AgentEvent =
  | AgentStepEvent
  | AgentStepResultEvent
  | AgentDeltaEvent
  | AgentDoneEvent
  | AgentErrorEvent;

/**
 * 流式调用 Agent 接口，逐事件 yield。
 * 用法：
 *   for await (const evt of streamAgent('查店铺数据并建议')) { ... }
 */
export async function* streamAgent(
  message: string,
  history: Array<{ role: string; content: string }> = [],
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
    signal,
  });

  if (!res.ok) {
    let errBody: unknown = null;
    try {
      errBody = await res.json();
    } catch {
      // ignore
    }
    throw new Error(problemMessage(parseProblem(errBody)));
  }

  if (!res.body) {
    throw new Error('响应无 body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 按行拆分，处理跨 chunk 的不完整行
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          const evt = JSON.parse(payload) as AgentEvent;
          yield evt;
        } catch {
          // 忽略非 JSON 行
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
