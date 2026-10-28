"use client";

import { StatusBadge } from "./StatusBadge";

export function PendingItem({
  orderId,
  type,
  amount,
  status,
  date,
  onAction,
}: {
  orderId: string;
  type: string;
  amount: number;
  status: string;
  date: string;
  onAction: (orderId: string) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2.5 transition hover:border-slate-200 hover:shadow-sm">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          <span className="text-xs text-slate-400">{type}</span>
        </div>
        <p className="text-sm font-medium text-slate-700">
          {orderId} · ¥{amount}
        </p>
        <p className="text-xs text-slate-400">{date}</p>
      </div>
      <button
        onClick={() => onAction(orderId)}
        className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700"
      >
        处理
      </button>
    </div>
  );
}
