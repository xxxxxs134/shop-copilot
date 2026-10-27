'use client';

import type { ReactNode } from 'react';

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

/**
 * 办理回执卡片（咨询即办理）
 *
 * Agent 完成退款/改址/物流拦截/退换货后，在步骤卡片内展示结构化结果回执：
 * 图标 + 成功标题 + 明细行（订单号/金额/单号/状态/时间），状态用 StatusBadge。
 */
export function ActionResultCard({
  action,
  data,
}: {
  action: ActionKind;
  data: Record<string, unknown>;
}) {
  const meta = ACTION_META[action];
  return (
    <div className="mt-2 rounded-lg border border-slate-200 border-l-4 border-l-emerald-500 bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="text-base" aria-hidden="true">
          {meta.icon}
        </span>
        <span className="text-sm font-medium text-emerald-700">{meta.title}</span>
      </div>
      <div className="mt-2 space-y-1 text-xs">{renderRows(action, flattenReceipt(data))}</div>
    </div>
  );
}

/** 各行动的明细行（字段取自对应回执形态） */
function renderRows(action: ActionKind, fields: Record<string, unknown>): ReactNode {
  switch (action) {
    case 'refund': {
      const orderId = pick(fields, ['order_id', 'order_no']) ?? '—';
      const amount = pick(fields, ['refund_amount', 'amount']) ?? '—';
      const aftersalesId = pick(fields, ['aftersales_id', 'after_sales_id']) ?? '—';
      const status = pick(fields, ['status']) ?? '已退款';
      const executedAt = pick(fields, ['executed_at', 'created_at']);
      return (
        <>
          <p className="text-slate-700">
            订单 {orderId} · ¥{amount}
          </p>
          <p className="flex items-center gap-1.5 text-slate-600">
            <span>售后单 #{aftersalesId} ·</span>
            <StatusBadge status={status} />
          </p>
          {executedAt ? <p className="text-slate-500">执行时间：{executedAt}</p> : null}
        </>
      );
    }
    case 'modify_address': {
      const orderId = pick(fields, ['order_id', 'order_no']) ?? '—';
      const oldAddress = pick(fields, ['old_address', 'original_address']);
      const newAddress = pick(fields, ['new_address', 'target_address']);
      return (
        <>
          <p className="text-slate-700">订单 {orderId}</p>
          {oldAddress ? (
            <div className="flex gap-1">
              <span className="shrink-0 text-slate-400">原地址：</span>
              <span className="min-w-0 truncate text-slate-600" title={oldAddress}>
                {oldAddress}
              </span>
            </div>
          ) : null}
          {newAddress ? (
            <div className="flex gap-1">
              <span className="shrink-0 text-slate-400">新地址：</span>
              <span className="min-w-0 truncate text-slate-600" title={newAddress}>
                {newAddress}
              </span>
            </div>
          ) : null}
        </>
      );
    }
    case 'intercept': {
      const orderId = pick(fields, ['order_id', 'order_no']) ?? '—';
      const trackingNo = pick(fields, ['tracking_no', 'waybill_no']);
      const status = pick(fields, ['status']) ?? '已拦截';
      return (
        <>
          <p className="text-slate-700">订单 {orderId}</p>
          {trackingNo ? (
            <p>
              <span className="text-slate-400">运单号：</span>
              <span className="text-slate-600">{trackingNo}</span>
            </p>
          ) : null}
          <p className="flex items-center gap-1.5">
            <span className="text-slate-400">状态：</span>
            <StatusBadge status={status} />
          </p>
        </>
      );
    }
    case 'return_exchange': {
      const returnId = pick(fields, ['return_id', 'aftersales_id']) ?? '—';
      const orderId = pick(fields, ['order_id', 'order_no']) ?? '—';
      const type = pick(fields, ['type', 'return_type']) ?? '退货退款';
      const status = pick(fields, ['status']) ?? '待寄回';
      return (
        <>
          <p className="text-slate-700">退货单 #{returnId}</p>
          <p className="text-slate-600">
            订单 {orderId} · {type}
          </p>
          <p className="flex items-center gap-1.5">
            <span className="text-slate-400">状态：</span>
            <StatusBadge status={status} />
          </p>
        </>
      );
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`未知行动类型: ${String(exhaustive)}`);
    }
  }
}
