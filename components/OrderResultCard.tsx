'use client';

import { StatusBadge } from './StatusBadge';

/** 商品名：优先 product 字段，否则取 items[0].name */
function productName(data: Record<string, unknown>): string {
  const direct = data.product;
  if (typeof direct === 'string' && direct !== '') return direct;
  const items = data.items;
  if (Array.isArray(items) && items.length > 0) {
    const first: unknown = items[0];
    if (first !== null && typeof first === 'object') {
      const name = (first as Record<string, unknown>).name;
      if (typeof name === 'string' && name !== '') return name;
    }
  }
  return '';
}

/**
 * 订单结果卡片（紧凑内联版）
 *
 * 一行摘要（订单号 · 商品 · 状态徽章）+ 一行明细（买家 · 金额 · 日期）。
 */
export function OrderResultCard({ data }: { data: Record<string, unknown> }) {
  // data fields: order_id, product/items, buyer, amount, status, created_at (optional)
  const product = productName(data);
  const created = typeof data.created_at === 'string' ? data.created_at : null;

  return (
    <div className="mt-1 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span aria-hidden="true">📦</span>
        <span className="font-medium text-slate-700">{String(data.order_id ?? '')}</span>
        {product && (
          <>
            <span className="text-slate-400">·</span>
            <span className="min-w-0 truncate text-slate-600">{product}</span>
          </>
        )}
        <span className="ml-auto">
          <StatusBadge status={String(data.status ?? '')} />
        </span>
      </div>
      <div className="mt-1 text-slate-400">
        买家 {String(data.buyer ?? '—')} · ¥{String(data.amount ?? '—')}
        {created ? ` · ${created}` : ''}
      </div>
    </div>
  );
}
