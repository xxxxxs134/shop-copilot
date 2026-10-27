'use client';

import { StatusBadge } from './StatusBadge';

export function OrderResultCard({ data }: { data: Record<string, unknown> }) {
  // data fields: order_id, buyer, amount, status, created_at (optional), items (optional)
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="text-base">📦</span>
        <span className="text-sm font-medium text-slate-800">订单 {String(data.order_id ?? '')}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div>
          <span className="text-slate-400">买家：</span>
          <span className="text-slate-700">{String(data.buyer ?? '—')}</span>
        </div>
        <div>
          <span className="text-slate-400">金额：</span>
          <span className="text-slate-700">¥{String(data.amount ?? '—')}</span>
        </div>
        <div>
          <span className="text-slate-400">状态：</span>
          <StatusBadge status={String(data.status ?? '')} />
        </div>
        {data.created_at ? (
          <div>
            <span className="text-slate-400">日期：</span>
            <span className="text-slate-700">{String(data.created_at)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
