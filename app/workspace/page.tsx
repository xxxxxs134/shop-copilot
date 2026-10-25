"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MetricCard } from "@/components/MetricCard";
import { PendingItem } from "@/components/PendingItem";
import { QuickAction } from "@/components/QuickAction";
import { RecentSession } from "@/components/RecentSession";

interface WorkspaceData {
  kpis: {
    gmv: number;
    gmv_trend: number;
    orders: number;
    orders_trend: number;
    refund_rate: number;
    refund_rate_trend: number;
    conversion: number;
    conversion_trend: number;
  };
  pending: Array<{
    order_id: string;
    type: string;
    amount: number;
    status: string;
    date: string;
  }>;
  recent_sessions: Array<{
    id: string;
    title: string;
    mode: string;
    updated_at: number;
  }>;
}

export default function WorkspacePage() {
  const router = useRouter();
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/workspace/summary")
      .then((r) => r.json())
      .then((d: WorkspaceData) => setData(d))
      .catch(() =>
        setData({
          kpis: { gmv: 0, gmv_trend: 0, orders: 0, orders_trend: 0, refund_rate: 0, refund_rate_trend: 0, conversion: 0, conversion_trend: 0 },
          pending: [],
          recent_sessions: [],
        }),
      )
      .finally(() => setLoading(false));
  }, []);

  const handlePendingAction = (orderId: string) => {
    sessionStorage.setItem("prefill_query", `帮我处理 ${orderId} 的退款`);
    router.push("/chat");
  };

  const handleSessionClick = (sessionId: string) => {
    sessionStorage.setItem("active_session_id", sessionId);
    router.push("/chat");
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  const k = data?.kpis;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-bold text-slate-800">运营工作台</h1>
        <p className="text-xs text-slate-400">今日经营概览 · 店智 Copilot</p>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        {/* KPI 卡片条 */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MetricCard label="今日 GMV" value={`¥${(k?.gmv ?? 0).toLocaleString()}`} trend={k?.gmv_trend} />
          <MetricCard label="订单数" value={k?.orders ?? 0} trend={k?.orders_trend} />
          <MetricCard label="退款率" value={k?.refund_rate ?? 0} suffix="%" trend={k?.refund_rate_trend} />
          <MetricCard label="转化率" value={k?.conversion ?? 0} suffix="%" trend={k?.conversion_trend} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* 待处理事项 */}
          <div className="lg:col-span-2">
            <h2 className="mb-3 text-sm font-semibold text-slate-600">
              待处理事项{data?.pending.length ? ` (${data.pending.length})` : ""}
            </h2>
            <div className="space-y-2">
              {data?.pending.length ? (
                data.pending.map((p) => (
                  <PendingItem
                    key={p.order_id + p.date}
                    orderId={p.order_id}
                    type={p.type}
                    amount={p.amount}
                    status={p.status}
                    date={p.date}
                    onAction={handlePendingAction}
                  />
                ))
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
                  暂无待处理事项
                </div>
              )}
            </div>
          </div>

          {/* 右侧栏：快捷操作 + 最近会话 */}
          <div className="space-y-6">
            <div>
              <h2 className="mb-3 text-sm font-semibold text-slate-600">快捷操作</h2>
              <div className="space-y-2">
                <QuickAction icon="💬" label="问 AI 助手" href="/chat" description="知识问答 · 数据查询 · 文案" />
                <QuickAction icon="📊" label="查看数据" href="/data" description="订单 · 商品 · 售后" />
                <QuickAction icon="📦" label="管理知识库" href="/kb" description="文档 · 切片 · 重建" />
              </div>
            </div>

            <div>
              <h2 className="mb-3 text-sm font-semibold text-slate-600">最近会话</h2>
              <div className="space-y-1 rounded-xl border border-slate-200 bg-white py-1">
                {data?.recent_sessions.length ? (
                  data.recent_sessions.map((s) => (
                    <RecentSession
                      key={s.id}
                      title={s.title}
                      mode={s.mode}
                      updatedAt={s.updated_at}
                      onClick={() => handleSessionClick(s.id)}
                    />
                  ))
                ) : (
                  <p className="px-3 py-4 text-center text-xs text-slate-400">暂无会话</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
