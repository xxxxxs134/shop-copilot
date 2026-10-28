'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MetricCard } from '@/components/MetricCard';
import { InsightCard } from '@/components/InsightCard';
import { RecentSession } from '@/components/RecentSession';
import { BarChart, KbStats, TrendChart, DonutChart } from '@/components/WorkspaceCharts';
import { RefundDialog } from '@/components/RefundDialog';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { statusMeta, TONE_HEX } from '@/lib/status';

interface PendingItem {
  order_id: string;
  type: string;
  amount: number;
  status: string;
  date: string;
  buyer: string;
  product: string;
}

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
  pending: PendingItem[];
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

const PRIMARY_LINK =
  'inline-flex items-center justify-center gap-1.5 rounded-control bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700';

const SECONDARY_LINK =
  'inline-flex items-center justify-center gap-1.5 rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-surface-muted';

const QUICK_ACTION =
  'flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left transition hover:bg-surface-muted';

const TRAFFIC_LABELS: Record<string, string> = {
  direct: '直接',
  paid: '付费',
  recommend: '推荐',
  search: '搜索',
};

function formatToday(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function WorkspacePage() {
  const router = useRouter();
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [today, setToday] = useState('');
  const [refundOrder, setRefundOrder] = useState<{
    order_id: string;
    product: string;
    buyer: string;
    amount: number;
    status: string;
    date: string;
  } | null>(null);

  // 日期在挂载后计算，避免服务端预渲染与客户端时区不一致造成的 hydration 抖动
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(formatToday(new Date()));
  }, []);

  useEffect(() => {
    fetch('/api/v1/workspace/summary')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: WorkspaceData) => setData(d))
      .catch(() => {
        setData(null);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [reloadKey]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(false);
    setReloadKey((k) => k + 1);
  }, []);

  const handlePendingAction = (orderId: string) => {
    const item = data?.pending.find((p) => p.order_id === orderId);
    if (item) {
      setRefundOrder({
        order_id: item.order_id,
        product: item.product,
        buyer: item.buyer,
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

  const handleCopywriting = () => {
    sessionStorage.setItem('prefill_query', '帮我写一段春季新品的商品文案，突出轻便和舒适');
    router.push('/chat');
  };

  if (loading) {
    return (
      <PageContainer className="space-y-6">
        <SkeletonCard rows={2} />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} rows={2} />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
            <SkeletonCard rows={4} />
            <SkeletonCard rows={4} />
          </div>
          <div className="space-y-6">
            <SkeletonCard rows={4} />
            <SkeletonCard rows={4} />
          </div>
        </div>
      </PageContainer>
    );
  }

  if (error || !data) {
    return (
      <PageContainer className="space-y-6">
        <PageHeader title="早上好，今天先看这三件事" description={today || undefined} />
        <Card>
          <CardBody>
            <EmptyState
              title="暂时拿不到经营数据"
              hint="数据服务可能未启动，重试一次或稍后再来看。"
              action={<Button onClick={reload}>重试</Button>}
            />
          </CardBody>
        </Card>
      </PageContainer>
    );
  }

  const k = data.kpis;
  const pending = data.pending;
  const insights = data.insights;
  const sessions = data.recent_sessions;

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        title="早上好，今天先看这三件事"
        description={today || undefined}
        actions={
          <Link href="/chat" className={PRIMARY_LINK}>
            问 AI
          </Link>
        }
      />

      {/* 关键指标 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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

      {/* 主区：左 2/3 洞察与待办，右 1/3 快捷操作与会话 */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Agent 今日洞察</CardTitle>
              {insights.length > 0 && <Badge tone="brand">{insights.length} 条</Badge>}
            </CardHeader>
            <CardBody className="space-y-2">
              {insights.length > 0 ? (
                insights.map((ins) => (
                  <InsightCard key={ins.text} icon={ins.icon} text={ins.text} type={ins.type} />
                ))
              ) : (
                <EmptyState
                  title="今天没有新的洞察"
                  hint="指标出现异常波动时，Agent 会在这里提示你。"
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Agent 发现 / 待办</CardTitle>
              {pending.length > 0 && <Badge tone="warning">{pending.length} 件</Badge>}
            </CardHeader>
            <CardBody className="space-y-3">
              {pending.length > 0 ? (
                pending.map((item) => {
                  const rejected = item.status === 'rejected' || item.status === '被拒';
                  const meta = statusMeta(item.status);
                  return (
                    <article
                      key={item.order_id + item.date}
                      className="rounded-card border border-line bg-surface-muted p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        <span className="text-xs text-ink-subtle">{item.date}</span>
                      </div>
                      <p className="mt-1.5 text-sm font-medium text-ink">
                        {rejected ? '退款申请被拒，需人工复查' : `${item.type || '售后'}，需跟进处理`}
                      </p>
                      <p className="mt-1 truncate text-xs text-ink-muted">
                        {[item.order_id, item.buyer, item.product, `¥${item.amount}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p className="mt-2 text-xs text-ink-muted">
                        建议：
                        {rejected
                          ? '复核驳回理由是否充分、凭证是否齐全'
                          : '确认退货物流签收情况，推进流程'}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Link
                          href={`/data?focus=${encodeURIComponent(item.order_id)}`}
                          className={SECONDARY_LINK}
                        >
                          查看详情
                        </Link>
                        <Button size="sm" onClick={() => handlePendingAction(item.order_id)}>
                          处理退款
                        </Button>
                      </div>
                    </article>
                  );
                })
              ) : (
                <EmptyState title="今天没有待办" hint="售后与退款都已处理完，可以放心去看数据。" />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>快捷操作</CardTitle>
            </CardHeader>
            <CardBody className="space-y-1 p-2">
              <Link href="/data" className={QUICK_ACTION}>
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-50 text-brand-700"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">查订单与售后</span>
                  <span className="block truncate text-xs text-ink-subtle">按订单号、状态筛选明细</span>
                </span>
              </Link>

              <Link href="/chat" className={QUICK_ACTION}>
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-50 text-brand-700"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4">
                    <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8Z" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">问 AI 助理</span>
                  <span className="block truncate text-xs text-ink-subtle">对话里直接查、直接办</span>
                </span>
              </Link>

              <button type="button" onClick={handleCopywriting} className={QUICK_ACTION}>
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-50 text-brand-700"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4">
                    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">生成商品文案</span>
                  <span className="block truncate text-xs text-ink-subtle">带上卖点，一键出标题</span>
                </span>
              </button>

              <Link href="/kb" className={QUICK_ACTION}>
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-50 text-brand-700"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4">
                    <path d="M12 6.5C10.5 5 8.5 4.5 4 4.5v13c4.5 0 6.5.5 8 2 1.5-1.5 3.5-2 8-2v-13c-4.5 0-6.5.5-8 2Z" strokeLinejoin="round" />
                    <path d="M12 6.5v13" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">维护知识库</span>
                  <span className="block truncate text-xs text-ink-subtle">改规则、补话术，问答即时生效</span>
                </span>
              </Link>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>最近会话</CardTitle>
            </CardHeader>
            <CardBody className="space-y-1 p-2">
              {sessions.length > 0 ? (
                sessions.map((s) => (
                  <RecentSession
                    key={s.id}
                    title={s.title}
                    mode={s.mode}
                    updatedAt={s.updated_at}
                    onClick={() => handleSessionClick(s.id)}
                  />
                ))
              ) : (
                <EmptyState title="还没有会话记录" hint="点右上角「问 AI」开始第一段对话。" />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>知识库状态</CardTitle>
            </CardHeader>
            <CardBody>
              <KbStats
                docCount={data.kb_stats?.doc_count ?? 0}
                chunkCount={data.kb_stats?.chunk_count ?? 0}
                retrievalScore={data.kb_stats?.retrieval_score ?? 0}
              />
            </CardBody>
          </Card>
        </div>
      </div>

      {/* 经营数据 */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">经营数据</h2>
          <span className="text-xs text-ink-subtle">近 30 天</span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>30 天经营趋势</CardTitle>
          </CardHeader>
          <CardBody>
            <TrendChart data={data.daily_trend ?? []} />
          </CardBody>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>热销商品 Top 3</CardTitle>
            </CardHeader>
            <CardBody>
              <BarChart
                items={(data.top_products ?? []).slice(0, 3).map((p) => ({
                  label: p.name,
                  value: p.sales,
                  suffix: ' 件',
                }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>流量来源占比</CardTitle>
            </CardHeader>
            <CardBody>
              <BarChart
                items={Object.entries(data.traffic_sources ?? {}).map(([source, value]) => ({
                  label: TRAFFIC_LABELS[source] ?? source,
                  value,
                  suffix: '%',
                }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>订单状态分布</CardTitle>
            </CardHeader>
            <CardBody>
              <DonutChart
                data={Object.entries(data.order_status_dist ?? {}).map(([status, value]) => ({
                  label: statusMeta(status).label,
                  value,
                  color: TONE_HEX[statusMeta(status).tone],
                }))}
              />
            </CardBody>
          </Card>
        </div>
      </section>

      {refundOrder && <RefundDialog order={refundOrder} onClose={() => setRefundOrder(null)} />}
    </PageContainer>
  );
}
