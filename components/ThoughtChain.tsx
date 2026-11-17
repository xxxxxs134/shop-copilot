'use client';

import { Fragment, useState } from 'react';
import type { ThoughtStep } from '@/lib/agentClient';
import { cn } from '@/lib/cn';

/** 专家花名册：一次请求只会命中其中一个，面板里全部列出、命中的高亮 */
const EXPERTS = [
  { key: 'presales', icon: '🛍️', label: '售前', title: '售前 Agent' },
  { key: 'aftersales', icon: '📦', label: '售后', title: '售后 Agent' },
  { key: 'escalation', icon: '🚨', label: '投诉', title: '投诉 Agent' },
  { key: 'clarify', icon: '❓', label: '澄清', title: '澄清 Agent' },
] as const;

const EXPERT_KEYS = EXPERTS.map((e) => e.key) as readonly string[];

/** 各节点展示名：Router / 专家 / Review，强调「不同角色交接」 */
const AGENT_META: Record<string, { icon: string; label: string }> = {
  router: { icon: '🧭', label: 'Router Agent' },
  presales: { icon: '🛍️', label: '售前 Agent' },
  aftersales: { icon: '📦', label: '售后 Agent' },
  escalation: { icon: '🚨', label: '投诉 Agent' },
  clarify: { icon: '❓', label: '澄清 Agent' },
  review: { icon: '✅', label: 'Review Agent' },
};

/**
 * 多 Agent 处理过程面板。
 * 顶部列出 4 个专家并高亮本轮命中者；Router 与专家之间显示 handoff；
 * 专家步骤展示工具调用轨迹；Review 只给裁决，不重复整段回复。
 */
export function ThoughtChain({ steps }: { steps: ThoughtStep[] }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;

  const specialist = steps.find((s) => EXPERT_KEYS.includes(s.agent));
  const specialistIndex = specialist ? steps.indexOf(specialist) : -1;
  const review = steps.find((s) => s.agent === 'review');
  const refused = Boolean(review?.detail?.includes('拒答'));

  return (
    <div className="w-full max-w-[80%] rounded-lg border border-line bg-surface-muted/50 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-ink-muted transition hover:text-ink"
        aria-expanded={open}
      >
        <span className="shrink-0" aria-hidden="true">🧠</span>
        <span className="font-medium">多 Agent 处理过程</span>
        <span className="text-ink-subtle">· {steps.length} 步</span>
        {specialist && (
          <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600">
            {AGENT_META[specialist.agent]?.label ?? specialist.agent} 接手
          </span>
        )}
        <span className="ml-auto text-ink-subtle" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="border-t border-line">
          {/* 专家花名册：4 个角色都在，命中者高亮 */}
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
            <span className="text-[10px] uppercase tracking-wider text-ink-subtle">4 个专家</span>
            {EXPERTS.map((expert) => {
              const active = specialist?.agent === expert.key;
              return (
                <span
                  key={expert.key}
                  title={expert.title}
                  className={cn(
                    'rounded-full border px-1.5 py-0.5 text-[10px]',
                    active
                      ? 'border-brand-600 bg-brand-50 font-medium text-brand-600'
                      : 'border-line text-ink-subtle',
                  )}
                >
                  {expert.icon} {expert.label}
                </span>
              );
            })}
            <span className="ml-auto text-[10px] text-ink-subtle">按意图选 1 个</span>
          </div>

          <ol className="border-t border-line/60">
            {steps.map((step, index) => {
              const meta = AGENT_META[step.agent] ?? { icon: '🤖', label: step.agent };
              const isRouter = step.agent === 'router';
              const isReview = step.agent === 'review';
              const showHandoff =
                specialistIndex >= 0 && index === specialistIndex && steps.some((s) => s.agent === 'router');

              return (
                <Fragment key={`${step.agent}-${index}`}>
                  {showHandoff && (
                    <li className="border-b border-line/60 bg-surface px-3 py-1 pl-9 text-[10px] text-ink-subtle">
                      ↳ Router → {AGENT_META[step.agent]?.label ?? step.agent}（handoff）
                    </li>
                  )}
                  <li
                    className={cn(
                      'flex items-start gap-2 px-3 py-2',
                      index < steps.length - 1 && 'border-b border-line/60',
                    )}
                  >
                    <span className="mt-0.5 shrink-0" aria-hidden="true">{meta.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-ink">{meta.label}</span>
                        {step.detail && (
                          <span
                            className={cn(
                              isReview
                                ? refused
                                  ? 'text-danger'
                                  : 'text-success'
                                : 'text-ink-subtle',
                            )}
                          >
                            · {step.detail}
                          </span>
                        )}
                      </div>

                      {isRouter && step.output && (
                        <p className="mt-0.5 text-ink-muted">
                          意图 <span className="font-mono text-ink">{step.output}</span>
                        </p>
                      )}

                      {!isRouter && !isReview && step.output && (
                        <p className="mt-1 whitespace-pre-wrap break-all rounded-control bg-surface px-2 py-1 font-mono text-[10px] leading-relaxed text-ink-muted">
                          {step.output}
                        </p>
                      )}
                    </div>
                  </li>
                </Fragment>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
