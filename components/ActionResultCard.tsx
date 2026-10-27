'use client';

import { StatusBadge } from './StatusBadge';

/** 办理回执卡片类型（咨询即办理：退款/改址/拦截/退换货） */
export type ActionKind = 'refund' | 'modify_address' | 'intercept' | 'return_exchange';

/** 每种行动的图标与标题 */
const ACTION_META: Record<ActionKind, { icon: string; title: string }> = {
  refund: { icon: '💰', title: '退款执行成功' },
  modify_address: { icon: '📬', title: '地址修改成功' },
  intercept: { icon: '🚚', title: '物流拦截成功' },
  return_exchange: { icon: '📦', title: '退换货单据已生成' },
};

/** 进行中状态 → 琥珀色提示；其余按成功绿色 */
const PENDING_STATUSES = new Set(['待寄回', '待处理', '处理中', '退款中', 'pending', 'processing', 'refunding']);

/** 从结果对象按候选键取标量字段（string/number → string，缺失返回 null） */
function pick(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value !== '') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** 结果可能是 { ok, receipt: {...} } 信封或平铺形态 → 拍平（receipt 字段优先） */
function flattenReceipt(data: Record<string, unknown>): Record<string, unknown> {
  const receipt = data.receipt;
  return receipt !== null && typeof receipt === 'object' && !Array.isArray(receipt)
    ? { ...data, ...(receipt as Record<string, unknown>) }
    : data;
}

/** 回执的一行明细（facts 供截断展示，title 提供完整文本） */
interface ActionLine {
  readonly facts: string;
  readonly status: string | null;
  readonly title?: string;
}

/** 各行动的一行明细（字段取自对应回执形态） */
function buildLine(action: ActionKind, fields: Record<string, unknown>): ActionLine {
  switch (action) {
    case 'refund': {
      const orderId = pick(fields, ['order_id', 'order_no']) ?? '—';
      const amount = pick(fields, ['refund_amount', 'amount']) ?? '—';
      const aftersalesId = pick(fields, ['aftersales_id', 'after_sales_id']) ?? '—';
      const status = pick(fields, ['status']) ?? '已退款';
      const executedAt = pick(fields, ['executed_at', 'created_at']);
      return {
        facts: `订单 ${orderId} · ¥${amount} · 售后单 #${aftersalesId}${executedAt ? ` · ${executedAt}` : ''}`,
        status,
      };
    }
    case 'modify_address': {
      const orderId = pick(fields, ['order_id', 'order_no']) ?? '—';
      const oldAddress = pick(fields, ['old_address', 'original_address']);
      const newAddress = pick(fields, ['new_address', 'target_address']);
      const move =
        oldAddress && newAddress ? `${oldAddress} → ${newAddress}` : (newAddress ?? oldAddress);
      const facts = `订单 ${orderId}${move ? ` · ${move}` : ''}`;
      return { facts, status: null, title: move ? facts : undefined };
    }
    case 'intercept': {
      const orderId = pick(fields, ['order_id', 'order_no']) ?? '—';
      const trackingNo = pick(fields, ['tracking_no', 'waybill_no']);
      const status = pick(fields, ['status']) ?? '已拦截';
      return {
        facts: `订单 ${orderId}${trackingNo ? ` · 运单 ${trackingNo}` : ''}`,
        status,
      };
    }
    case 'return_exchange': {
      const returnId = pick(fields, ['return_id', 'aftersales_id']) ?? '—';
      const orderId = pick(fields, ['order_id', 'order_no']) ?? '—';
      const type = pick(fields, ['type', 'return_type']) ?? '退货退款';
      const status = pick(fields, ['status']) ?? '待寄回';
      return { facts: `退货单 #${returnId} · 订单 ${orderId} · ${type}`, status };
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`未知行动类型: ${String(exhaustive)}`);
    }
  }
}

/**
 * 办理回执卡片（咨询即办理 · 紧凑内联版）
 *
 * 一行头部（图标 + 标题 + 状态徽章）+ 一行明细。
 * 背景按结果着色：成功 emerald、进行中 amber。
 */
export function ActionResultCard({
  action,
  data,
}: {
  action: ActionKind;
  data: Record<string, unknown>;
}) {
  const meta = ACTION_META[action];
  const line = buildLine(action, flattenReceipt(data));
  const pending = line.status !== null && PENDING_STATUSES.has(line.status);

  return (
    <div
      className={`mt-2 rounded-md border px-3 py-2 text-xs ${
        pending ? 'border-amber-100 bg-amber-50' : 'border-emerald-100 bg-emerald-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true">{meta.icon}</span>
        <span
          className={`font-medium ${pending ? 'text-amber-700' : 'text-emerald-700'}`}
        >
          {meta.title}
        </span>
        {line.status !== null && (
          <span className="ml-auto">
            <StatusBadge status={line.status} />
          </span>
        )}
      </div>
      <p className="mt-1 min-w-0 truncate text-slate-600" title={line.title}>
        {line.facts}
      </p>
    </div>
  );
}
