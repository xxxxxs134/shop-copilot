'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MetricCard } from '@/components/MetricCard';
import { InsightCard } from '@/components/InsightCard';
import { PendingItem } from '@/components/PendingItem';
import { RecentSession } from '@/components/RecentSession';
import {
  BarChart,
  KbStats,
  IntentDist,
  TrendChart,
  DonutChart,
} from '@/components/WorkspaceCharts';
import { RefundDialog } from '@/components/RefundDialog';

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
  insights: Array<{ icon: string; text: string; type: string }>;
  top_products: Array<{ name: string; sales: number; gmv: number }>;
  traffic_sources: Record<string, number>;
  daily_trend: Array<{ date: string; gmv: number; orders: number }>;
  order_status_dist: Record<string, number>;
  kb_stats: { doc_count: number; chunk_count: number; retrieval_score: number };
}

const ORDER_STATUS_META: Record<string, { label: string; color: string }> = {
  paid: { label: '已付', color: '#3b82f6' },
  shipped: { label: '已发', color: '#8b5cf6' },
  received: { label: '已收', color: '#10b981' },
  refunding: { label: '退款中', color: '#f59e0b' },
  refunded: { label: '已退款', color: '#6b7280' },
  rejected: { label: '被拒', color: '#ef4444' },
  unpaid: { label: '未付', color: '#94a3b8' },
};

export default function WorkspacePage() {
  const router = useRouter();
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refundOrder, setRefundOrder] = useState<{
    order_id: string;
    product: string;
    buyer: string;
    amount: number;
    status: string;
    date: string;
  } | null>(null);

  useEffect(() => {
    fetch('/api/v1/workspace/summary')
      .then((r) => r.json())
      .then((d: WorkspaceData) => setData(d))
      .catch(() =>
        setData({
          kpis: {
            gmv: 0,
            gmv_trend: 0,
            orders: 0,
            orders_trend: 0,
            refund_rate: 0,
            refund_rate_trend: 0,
            conversion: 0,
            conversion_trend: 0,
          },
          pending: [],
          recent_sessions: [],
          insights: [],
          top_products: [],
          traffic_sources: {},
          daily_trend: [],
          order_status_dist: {},
          kb_stats: { doc_count: 0, chunk_count: 0, retrieval_score: 0 },
        }),
      )
      .finally(() => setLoading(false));
  }, []);

  const handlePendingAction = (orderId: string) => {
    const item = data?.pending.find((p) => p.order_id === orderId);
    if (item) {
      setRefundOrder({
        order_id: item.order_id,
        product: item.type,
        buyer: '—',
        amount: item.amount,
        status: item.status,
        date: item.date,
      });
    }
  };

  const handleSessionClick = (sessionId: string) => {
    sessionStorage.setItem('active_session_id', sessionId);
    router.push('/chat');
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
      <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-6">
        {/* KPI 卡片条 */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MetricCard
            label="今日 GMV"
            value={`¥${(k?.gmv ?? 0).toLocaleString()}`}
            trend={k?.gmv_trend}
          />
          <MetricCard label="订单数" value={k?.orders ?? 0} trend={k?.orders_trend} />
          <MetricCard
            label="退款率"
            value={k?.refund_rate ?? 0}
            suffix="%"
            trend={k?.refund_rate_trend}
          />
          <MetricCard
            label="转化率"
            value={k?.conversion ?? 0}
            suffix="%"
            trend={k?.conversion_trend}
          />
        </div>

        {/* Agent 今日洞察 */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-600">💡 Agent 今日洞察</h2>
          <div className="space-y-2">
            {(data?.insights ?? []).length ? (
              (data?.insights ?? []).map((ins) => (
                <InsightCard key={ins.text} icon={ins.icon} text={ins.text} type={ins.type} />
              ))
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
                暂无洞察
              </div>
            )}
          </div>
        </div>

        {/* 待处理事项（全宽） */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-600">
            待处理事项{data?.pending.length ? ` (${data.pending.length})` : ''}
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

        {/* 热销 + 流量 + 状态分布（三列） */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-xs font-semibold text-slate-500">热销商品 Top 3</h3>
            <BarChart
              items={(data?.top_products ?? []).slice(0, 3).map((p) => ({
                label: p.name,
                value: p.sales,
                suffix: ' 件',
              }))}
            />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-xs font-semibold text-slate-500">流量来源占比</h3>
            <BarChart
              items={Object.entries(data?.traffic_sources ?? {}).map(([k, v]) => ({
                label:
                  k === 'direct'
                    ? '直接'
                    : k === 'paid'
                      ? '付费'
                      : k === 'recommend'
                        ? '推荐'
                        : k === 'search'
                          ? '搜索'
                          : k,
                value: v,
                suffix: '%',
              }))}
            />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-xs font-semibold text-slate-500">订单状态分布</h3>
            <DonutChart
              data={Object.entries(data?.order_status_dist ?? {}).map(([status, value]) => ({
                label: ORDER_STATUS_META[status]?.label ?? status,
                value,
                color: ORDER_STATUS_META[status]?.color ?? '#94a3b8',
              }))}
            />
          </div>
        </div>

        {/* 30 天趋势（全宽） */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-xs font-semibold text-slate-500">30 天经营趋势</h3>
          <TrendChart data={data?.daily_trend ?? []} />
        </div>

        {/* 知识库 + 意图分布（两列） */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-xs font-semibold text-slate-500">知识库状态</h3>
            <KbStats
              docCount={data?.kb_stats?.doc_count ?? 0}
              chunkCount={data?.kb_stats?.chunk_count ?? 0}
              retrievalScore={data?.kb_stats?.retrieval_score ?? 0}
            />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-xs font-semibold text-slate-500">意图分布</h3>
            <IntentDist
              counts={
                data?.recent_sessions.reduce(
                  (acc, s) => {
                    const intent = s.mode === 'agent' ? 'data' : 'knowledge';
                    acc[intent] = (acc[intent] ?? 0) + 1;
                    return acc;
                  },
                  {} as Record<string, number>,
                ) ?? {}
              }
            />
          </div>
        </div>

        {/* 最近会话（全宽，快捷操作已移入左侧导航） */}
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
      </main>

      {refundOrder && <RefundDialog order={refundOrder} onClose={() => setRefundOrder(null)} />}
    </div>
  );
}
