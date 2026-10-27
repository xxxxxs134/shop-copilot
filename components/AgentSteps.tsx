'use client';

import { Fragment, useState } from 'react';

import { ActionResultCard, type ActionKind } from './ActionResultCard';
import { OrderResultCard } from './OrderResultCard';

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
  modify_address: '地址修改',
  intercept_logistics: '物流拦截',
  return_exchange: '退换货',
};

const TOOL_ICONS: Record<string, string> = {
  kb_search: '📚',
  data_query: '📊',
  copywriting: '✍️',
  policy_check: '🛡️',
  order_lookup: '📦',
  product_lookup: '🛍️',
  refund_flow: '💰',
  modify_address: '📬',
  intercept_logistics: '🚚',
  return_exchange: '📦',
};

/** 推理理由兜底映射（步骤数据缺 reason 时按工具名生成） */
const TOOL_REASONS: Record<string, string> = {
  order_lookup: '用户询问订单信息，查询订单数据',
  product_lookup: '用户询问商品信息，查询商品数据',
  kb_search: '需要知识库内容辅助回答',
  data_query: '用户需要经营数据分析',
  refund_flow: '处理退款操作',
  modify_address: '处理地址修改操作',
  intercept_logistics: '处理物流拦截操作',
  return_exchange: '处理退换货操作',
  copywriting: '生成商品文案',
  policy_check: '检查合规规则',
};

/**
 * 解析 order_lookup 结果：summary 可能是 JSON 字符串或已解析的对象。
 * 含 order_id 视为订单数据，否则返回 null（保持纯文本展示）。
 */
function parseOrderData(summary: unknown): Record<string, unknown> | null {
  let raw: unknown;
  if (typeof summary === 'string') {
    try {
      raw = JSON.parse(summary);
    } catch {
      return null;
    }
  } else {
    raw = summary;
  }
  return raw !== null && typeof raw === 'object' && 'order_id' in raw
    ? (raw as Record<string, unknown>)
    : null;
}

/** 可出办理回执的行动类工具（与 TOOL_ACTION 一一对应） */
const ACTION_TOOLS = ['refund_flow', 'modify_address', 'intercept_logistics', 'return_exchange'];

/** 行动类工具名 → 办理回执卡片类型 */
const TOOL_ACTION: Record<string, ActionKind> = {
  refund_flow: 'refund',
  modify_address: 'modify_address',
  intercept_logistics: 'intercept',
  return_exchange: 'return_exchange',
};

/**
 * 解析行动类工具的办理结果：summary 为 JSON 且含 receipt 字段或 ok: true 时，
 * 返回 ActionResultCard 所需的 action + data，否则返回 null。
 * refund_flow 的 validate 段（needs_confirm 预览）不是办理结果，不出卡。
 */
function parseActionResult(
  step: AgentStep,
): { action: ActionKind; data: Record<string, unknown> } | null {
  if (!step.done || !ACTION_TOOLS.includes(step.tool)) return null;
  const action = TOOL_ACTION[step.tool];
  let raw: unknown;
  if (typeof step.summary === 'string') {
    try {
      raw = JSON.parse(step.summary);
    } catch {
      return null;
    }
  } else {
    raw = step.summary;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  if (data.needs_confirm === true) return null;
  return 'receipt' in data || data.ok === true ? { action, data } : null;
}

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
        <span>⚙️ 调用了 {stepCount} 个工具</span>
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

  // args 摘要（折叠行副标题 + 展开区完整展示）
  const argsBrief = Object.entries(step.args)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' · ');

  // 行动类工具的办理回执（咨询即办理）
  const actionResult = parseActionResult(step);
  // order_lookup 完成后解析 summary → 结构化订单卡片
  const orderData =
    step.tool === 'order_lookup' && step.done ? parseOrderData(step.summary) : null;

  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
      {/* 折叠行：工具名 · 简短参数 · 状态 · 耗时（点击展开详情） */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-left"
      >
        <span aria-hidden="true">{icon}</span>
        <span className="shrink-0 font-medium text-slate-700">{label}</span>
        {argsBrief && (
          <span className="min-w-0 truncate text-slate-400">· {argsBrief}</span>
        )}
        {!step.done && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-slate-400">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
            运行中
          </span>
        )}
        {step.done && <span className="ml-auto shrink-0 text-emerald-600">✓ 完成</span>}
        {durationText && <span className="shrink-0 text-slate-400">{durationText}</span>}
        <span aria-hidden="true" className="shrink-0 text-slate-400">
          {expanded ? '▴' : '▾'}
        </span>
      </button>

      {/* 展开区：推理理由 + 完整参数 + result summary + 结果卡片 */}
      {expanded && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <p className="text-slate-600">💭 {reason}</p>
          {argsBrief && <p className="mt-1 break-all text-slate-500">{argsBrief}</p>}
          {step.summary && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-slate-600">
              {typeof step.summary === 'string'
                ? step.summary
                : JSON.stringify(step.summary, null, 2)}
            </pre>
          )}
          {orderData && <OrderResultCard data={orderData} />}
          {actionResult && (
            <ActionResultCard action={actionResult.action} data={actionResult.data} />
          )}
        </div>
      )}
    </div>
  );
}
