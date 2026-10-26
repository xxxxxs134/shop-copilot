/**
 * Agent 单轮执行器（从 ChatWindow 抽取，保持组件 <250 LOC）
 *
 * 职责：调 streamAgent 消费 SSE，把步骤/文本增量通过回调推回组件。
 * 状态搬运（setAgentMessages）由调用方实现，本模块不持有 React 状态。
 */

import { streamAgent } from './agentClient';
import type { AgentStep } from '@/components/AgentSteps';

export interface AgentRunState {
  text: string;
  steps: AgentStep[];
}

/**
 * 执行一轮 Agent 流式对话。
 *
 * @param message  本轮 user 消息
 * @param history  之前轮次（role/content，不含本轮）
 * @param onUpdate 每次步骤/文本变化回调（调用方替换最后一条 assistant 消息）
 * @param onError  错误回调（含模型返回的 error 事件；AbortError 静默）
 */
export async function runAgentStream(
  message: string,
  history: Array<{ role: string; content: string }>,
  onUpdate: (state: AgentRunState) => void,
  onError: (message: string) => void,
  signal: AbortSignal,
): Promise<void> {
  let text = '';
  let steps: AgentStep[] = [];
  let counter = 0;
  // 记录每个步骤的开始时刻，step_result 到达时算出耗时
  const stepStartedAt = new Map<string, number>();

  try {
    for await (const evt of streamAgent(message, history, signal)) {
      if (evt.type === 'step') {
        const id = `step-${counter++}`;
        stepStartedAt.set(id, Date.now());
        steps = [...steps, { id, tool: evt.tool, args: evt.args, done: false }];
        onUpdate({ text, steps });
      } else if (evt.type === 'step_result') {
        const next = [...steps];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].tool === evt.tool) {
            const startedAt = stepStartedAt.get(next[i].id);
            next[i] = {
              ...next[i],
              summary: evt.summary,
              done: true,
              durationMs: startedAt === undefined ? undefined : Date.now() - startedAt,
            };
            break;
          }
        }
        steps = next;
        onUpdate({ text, steps });
      } else if (evt.type === 'delta') {
        text += evt.text;
        onUpdate({ text, steps });
      } else if (evt.type === 'error') {
        onError(evt.message);
        break;
      }
      if (evt.type === 'done') break;
    }
  } catch (err) {
    // 用户主动停止不作为错误
    if (err instanceof Error && err.name !== 'AbortError') {
      onError(err.message);
    }
  }
}
