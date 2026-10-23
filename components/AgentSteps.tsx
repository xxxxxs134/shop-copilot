'use client';

import { useState } from 'react';

/** 一个 Agent 工具调用步骤（开始 + 结果） */
export interface AgentStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  summary?: string; // step_result 到达后填充
  done: boolean;
}

/** 工具中文名映射 */
const TOOL_LABELS: Record<string, string> = {
  kb_search: '知识库检索',
  data_query: '数据查询',
  copywriting: '文案生成',
  policy_check: '合规检查',
};

const TOOL_ICONS: Record<string, string> = {
  kb_search: '📚',
  data_query: '📊',
  copywriting: '✍️',
  policy_check: '🛡️',
};

/**
 * Agent 步骤卡片列表
 *
 * 渲染 Agent 运行过程中的工具调用轨迹，让用户看见「AI 在想什么、做了什么」。
 * 设计参考：OmniMerchant trace / merchant-agent 进度回调 → 简化为步骤卡片。
 */
export function AgentSteps({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) return null;

  return (
    <div className="mb-2 space-y-2">
      {steps.map((step) => (
        <StepCard key={step.id} step={step} />
      ))}
    </div>
  );
}

function StepCard({ step }: { step: AgentStep }) {
  const [expanded, setExpanded] = useState(false);
  const label = TOOL_LABELS[step.tool] ?? step.tool;
  const icon = TOOL_ICONS[step.tool] ?? '🔧';

  // args 摘要（用于卡片副标题）
  const argsBrief = Object.entries(step.args)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' · ');

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">{icon}</span>
          <span className="font-medium text-slate-700">{label}</span>
          {!step.done && (
            <span className="inline-flex items-center gap-1 text-slate-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
              运行中
            </span>
          )}
          {step.done && <span className="text-green-600">✓ 完成</span>}
        </div>
        {step.summary && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 text-slate-400 hover:text-slate-600"
          >
            {expanded ? '收起' : '详情'}
          </button>
        )}
      </div>
      {/* args 摘要（截断显示） */}
      {argsBrief && (
        <p className="mt-1 truncate text-slate-500">{argsBrief}</p>
      )}
      {/* 展开后显示完整 result summary */}
      {expanded && step.summary && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-slate-600">
          {step.summary}
        </pre>
      )}
    </div>
  );
}
