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
export function OrderResultCard({ data, onAction }: { data: Record<string, unknown>; onAction?: (order: { order_id: string; product: string; buyer: string; amount: number; status: string; date: string }) => void }) {
  const product = productName(data);
  const created = typeof data.created_at === 'string' ? data.created_at : '';
  const status = String(data.status ?? '');
  const refundable = [
    'paid', 'shipped', 'received', 'refunding', 'rejected',
    '已支付', '已发货', '已收货', '退款中', '已拒绝',
  ].includes(status);

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
  {onAction && refundable && (
    <button
      type="button"
      onClick={() =>
        onAction({
          order_id: String(data.order_id ?? ''),
          product,
          buyer: String(data.buyer ?? ''),
          amount: Number(data.amount ?? 0),
          status,
          date: created,
        })
      }
      className="mt-2 w-full rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700"
    >
      💰 处理退款
    </button>
  )}
</div>
  );
}
