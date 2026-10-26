'use client';

import { Fragment, useState } from 'react';

/** 一个 Agent 工具调用步骤（开始 + 结果） */
export interface AgentStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  summary?: string; // step_result 到达后填充
  done: boolean;
  /** 推理理由：优先取步骤数据自带字段，缺失时按工具名推导 */
  reason?: string;
  /** 工具执行耗时（毫秒，step_result 到达时记录） */
  durationMs?: number;
}

/** 工具中文名映射 */
const TOOL_LABELS: Record<string, string> = {
  kb_search: '知识库检索',
  data_query: '数据查询',
  copywriting: '文案生成',
  policy_check: '合规检查',
  order_lookup: '订单查询',
  product_lookup: '商品查询',
  refund_flow: '退款流程',
};

const TOOL_ICONS: Record<string, string> = {
  kb_search: '📚',
  data_query: '📊',
  copywriting: '✍️',
  policy_check: '🛡️',
  order_lookup: '📦',
  product_lookup: '🛍️',
  refund_flow: '💰',
};

/** 推理理由兜底映射（步骤数据缺 reason 时按工具名生成） */
const TOOL_REASONS: Record<string, string> = {
  order_lookup: '用户询问订单信息，查询订单数据',
  product_lookup: '用户询问商品信息，查询商品数据',
  kb_search: '需要知识库内容辅助回答',
  data_query: '用户需要经营数据分析',
  refund_flow: '处理退款操作',
  copywriting: '生成商品文案',
  policy_check: '检查合规规则',
};

/**
 * Agent 步骤卡片列表
 *
 * 渲染 Agent 运行过程中的工具调用轨迹，让用户看见「AI 在想什么、做了什么」。
 * 设计参考：OmniMerchant trace / merchant-agent 进度回调 → 简化为步骤卡片。
 */
export function AgentSteps({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) return null;

  const stepCount = steps.length;

  return (
    <div className="mb-2 space-y-2">
      {steps.map((step, index) => (
        <Fragment key={step.id}>
          {index > 0 && (
            <div aria-hidden="true" className="text-center text-[10px] leading-none text-slate-300">
              ↓
            </div>
          )}
          <StepCard step={step} />
        </Fragment>
      ))}
      <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <span>⚙️ 本次调用 {stepCount} 个工具</span>
      </div>
    </div>
  );
}

function StepCard({ step }: { step: AgentStep }) {
  const [expanded, setExpanded] = useState(false);
  const label = TOOL_LABELS[step.tool] ?? step.tool;
  const icon = TOOL_ICONS[step.tool] ?? '🔧';
  const reason = step.reason ?? TOOL_REASONS[step.tool] ?? `调用${label}工具辅助回答`;
  const durationText =
    step.durationMs === undefined
      ? null
      : step.durationMs < 1000
        ? `${Math.round(step.durationMs)}ms`
        : `${(step.durationMs / 1000).toFixed(1)}s`;

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
          {durationText && <span className="text-slate-400">{durationText}</span>}
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
      {/* 推理理由 */}
      <p className="mt-1 text-slate-600">💭 {reason}</p>
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
