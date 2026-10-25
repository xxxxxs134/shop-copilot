"use client";

import { useEffect, useState } from "react";
import { OrderTimeline } from "./OrderTimeline";
import { StatusBadge } from "./StatusBadge";

interface OrderDetail {
  order_id: string;
  product: string;
  buyer: string;
  amount: number;
  status: string;
  date: string;
  timeline: Array<{ date: string; label: string; status: string }>;
}

export function OrderDetailCard({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/data/order/${orderId}`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((d: OrderDetail) => setOrder(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [orderId]);

  return (
    <div className="absolute right-0 top-0 z-20 h-full w-72 border-l border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-700">订单详情</h3>
        <button onClick={onClose} className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
          ✕
        </button>
      </div>

      <div className="overflow-y-auto px-4 py-3" style={{ maxHeight: "calc(100% - 48px)" }}>
        {loading ? (
          <div className="space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
          </div>
        ) : error || !order ? (
          <p className="text-sm text-slate-400">订单不存在</p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-slate-400">订单号</p>
              <p className="text-sm font-medium text-slate-800">{order.order_id}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">商品</p>
              <p className="text-sm text-slate-700">{order.product}</p>
            </div>
            <div className="flex gap-4">
              <div>
                <p className="text-xs text-slate-400">买家</p>
                <p className="text-sm text-slate-700">{order.buyer}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">金额</p>
                <p className="text-sm font-medium text-slate-800">¥{order.amount}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-400">状态</p>
              <StatusBadge status={order.status} />
            </div>
            <div>
              <p className="mb-2 text-xs text-slate-400">时间线</p>
              <OrderTimeline events={order.timeline} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
