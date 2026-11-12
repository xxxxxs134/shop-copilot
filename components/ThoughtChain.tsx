'use client';

import { useState } from 'react';
import type { ThoughtStep } from '@/lib/agentClient';
import { cn } from '@/lib/cn';

/** 各 agent 的中文标签 + 图标（对齐 RTY798「Agent 处理过程」） */
const AGENT_LABELS: Record<string, { icon: string; label: string }> = {
  router: { icon: '🧭', label: '意图路由' },
  presales: { icon: '🛍️', label: '售前客服' },
  aftersales: { icon: '📦', label: '售后客服' },
  escalation: { icon: '🚨', label: '投诉升级' },
  clarify: { icon: '❓', label: '澄清追问' },
  review: { icon: '✅', label: '终审' },
};

/**
 * 多 Agent 处理过程面板（可折叠）。
 * 展示这一轮对话经历了哪些 agent：router → specialist → review，每步留痕。
 * 默认收起，点击「Agent 处理过程」展开（参考 RTY798 的交互）。
 */
export function ThoughtChain({ steps }: { steps: ThoughtStep[] }) {
  const [open, setOpen] = useState(true);
  if (steps.length === 0) return null;

  return (
    <div className="w-full max-w-[80%] rounded-lg border border-line bg-surface-muted/50 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-ink-muted transition hover:text-ink"
        aria-expanded={open}
      >
        <span className="shrink-0" aria-hidden="true">🧠</span>
        <span className="font-medium">Agent 处理过程</span>
        <span className="text-ink-subtle">· {steps.length} 步</span>
        <span className="ml-auto text-ink-subtle" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <ol className="space-y-0 border-t border-line">
          {steps.map((s, i) => {
            const meta = AGENT_LABELS[s.agent] ?? { icon: '🤖', label: s.agent };
            return (
              <li
                key={i}
                className={cn(
                  'flex items-start gap-2 px-3 py-2',
                  i < steps.length - 1 && 'border-b border-line/60',
                )}
              >
                <span className="mt-0.5 shrink-0" aria-hidden="true">{meta.icon}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-ink">{meta.label}</span>
                    {s.detail && <span className="text-ink-subtle">· {s.detail}</span>}
                  </div>
                  {s.output && (
                    <p className="mt-0.5 line-clamp-2 break-words text-ink-muted">{s.output}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
