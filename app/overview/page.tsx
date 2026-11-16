import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/cn';

export const metadata: Metadata = {
  title: '系统概览 - 店智 Copilot',
};

/**
 * 系统概览：只陈述仓库事实基线（6 节点 / 10 工具 / 43 篇语料 / 20 单种子数据），
 * 不引入任何虚构指标。信息层级：一次请求怎么走 → 质量与边界 → 工具注册表 → 演示路线。
 */

// 与 components/ui/Button 的 primary / secondary 同款样式（Link 不能包 button）
const ACTION_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-control px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';
const ACTION_PRIMARY = 'bg-brand-600 text-white hover:bg-brand-700';
const ACTION_SECONDARY = 'border border-line bg-surface text-ink hover:bg-surface-muted';

interface Kpi {
  readonly value: string;
  readonly label: string;
  readonly detail: string;
}

const KPIS: readonly Kpi[] = [
  { value: '6', label: '编排节点', detail: 'Router、澄清、售前、售后、投诉、终审' },
  { value: '10', label: '注册工具', detail: '7 个客服工具 + 3 个运营向工具' },
  { value: '43', label: '知识库语料', detail: '覆盖平台规则与售后政策' },
  { value: '20', label: '种子订单', detail: '30 天本地演示数据' },
];

interface Stage {
  readonly no: string;
  /** 英文环节名，以等宽字体呈现 */
  readonly name?: string;
  readonly title: string;
  readonly desc: string;
}

const STAGES: readonly Stage[] = [
  {
    no: '01',
    name: 'Router',
    title: '判意图',
    desc: '售前 / 售后 / 投诉 / 澄清，先分流再回答，带置信度与情绪',
  },
  {
    no: '02',
    title: '专家调工具',
    desc: '单轮命中 1 个专家，工具轨迹与 handoff 留痕',
  },
  {
    no: '03',
    name: 'Review',
    title: '校验',
    desc: '无工具证据拒答；有知识命中但缺 [n] 记录告警',
  },
  {
    no: '04',
    title: '回执或引用',
    desc: '订单卡、退款回执、TK 工单号、[n] 来源卡片',
  },
];

const EXPERTS: readonly string[] = ['售前', '售后', '投诉', '澄清'];

interface QualityRow {
  readonly label: string;
  /** 数值行使用 value；状态行使用 badge 文本 */
  readonly value?: string;
  readonly badge?: string;
  readonly detail?: string;
  readonly mono?: boolean;
}

const QUALITY_ROWS: readonly QualityRow[] = [
  { label: '检索自测', value: '90%', detail: '9 / 10' },
  { label: 'RAG 评测 v2', value: '29 / 30', detail: '无 RAG 30/30，增量在私有规则与引用' },
  { label: '交付冒烟', value: '9 / 9' },
  { label: 'tsc · eslint · build', badge: '全绿', mono: true },
];

interface Tool {
  readonly name: string;
  /** MCP 独立进程暴露的工具，用文字标签标注（不靠颜色单独传达） */
  readonly mcp?: boolean;
}

interface ToolGroup {
  readonly label: string;
  readonly tools: readonly Tool[];
}

const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    label: '客服',
    tools: [
      { name: 'product_lookup' },
      { name: 'kb_search', mcp: true },
      { name: 'order_lookup' },
      { name: 'refund_flow' },
      { name: 'modify_address' },
      { name: 'intercept_logistics' },
      { name: 'return_exchange' },
    ],
  },
  {
    label: '运营向',
    tools: [
      { name: 'data_query', mcp: true },
      { name: 'copywriting', mcp: true },
      { name: 'policy_check', mcp: true },
    ],
  },
];

interface DemoRoute {
  readonly no: string;
  readonly title: string;
  readonly prompt: string;
  readonly result: string;
}

const DEMO_ROUTES: readonly DemoRoute[] = [
  {
    no: '01',
    title: '查订单',
    prompt: 'SO20261027009 到哪了？',
    result: '订单卡 + 物流 + 运单号',
  },
  {
    no: '02',
    title: '办退款',
    prompt: '订单 SO20261027001，帮我退 80 块',
    result: '预览 80 / 159.8 / 79.8 → 确认 → 回执',
  },
  {
    no: '03',
    title: '投诉建单',
    prompt: '等了一周还没到，太失望了，我要投诉！',
    result: '情绪识别 + TK 工单号 + 处理方案',
  },
];

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export default function OverviewPage() {
  return (
    <main className="min-h-screen">
      <PageContainer>
        {/* 移动端 16px / sm 起 24px 边距：PageContainer 固定 px-6，这里用 -mx-2 抵消 8px */}
        <div className="-mx-2 w-auto space-y-5 sm:mx-0">
          {/* 页头 */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-brand-600">
              系统概览 · 比赛演示
            </p>
            <PageHeader
              title="一次看清这套客服 Agent 怎么运转"
              description="不是聊天页：路由、专家、工具、终审与回执，每一层都能对上证据。"
              actions={
                <>
                  <Link href="/chat" className={cn(ACTION_BASE, ACTION_PRIMARY)}>
                    打开客服对话
                  </Link>
                  <Link href="/kb" className={cn(ACTION_BASE, ACTION_SECONDARY)}>
                    维护知识库
                  </Link>
                </>
              }
            />
          </div>

          {/* 关键规模 */}
          <section aria-labelledby="scale-heading" className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="scale-heading" className="text-sm font-semibold text-ink">
                关键规模
              </h2>
              <p className="text-[11px] text-ink-subtle">事实基线 · 截至提交版本</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {KPIS.map((kpi) => (
                <Card key={kpi.label} className="p-4">
                  <p className="text-3xl font-semibold tracking-tight tabular-nums text-ink">
                    {kpi.value}
                  </p>
                  <p className="mt-1 text-sm font-medium text-ink">{kpi.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-subtle">{kpi.detail}</p>
                </Card>
              ))}
            </div>
          </section>

          {/* 主区：8 / 4 分栏 */}
          <div className="grid gap-5 xl:grid-cols-12">
            {/* 一次请求怎么走 */}
            <div className="min-w-0 xl:col-span-8">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>一次请求怎么走</CardTitle>
                  <Badge tone="brand">LangGraph</Badge>
                </CardHeader>
                <CardBody className="space-y-5">
                  <ol>
                    {STAGES.map((stage, index) => {
                      const hasNext = index < STAGES.length - 1;
                      return (
                        <li key={stage.no} className="grid grid-cols-[2rem_1fr] gap-x-3">
                          <div className="flex flex-col items-center">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-brand-100 bg-brand-50 text-[11px] font-semibold tabular-nums text-brand-700">
                              {stage.no}
                            </span>
                            {hasNext && (
                              <span aria-hidden="true" className="mt-1 w-px flex-1 bg-line" />
                            )}
                          </div>
                          <div className={cn('min-w-0 pt-1.5', hasNext ? 'pb-4' : 'pb-0')}>
                            <p className="text-sm font-semibold text-ink">
                              {stage.name && (
                                <span className="mr-1 font-mono text-[13px]">{stage.name}</span>
                              )}
                              {stage.title}
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                              {stage.desc}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>

                  <div className="border-t border-line pt-4">
                    <ul className="flex flex-wrap gap-1.5">
                      {EXPERTS.map((expert) => (
                        <li
                          key={expert}
                          className="rounded-full border border-line bg-surface-muted px-2.5 py-1 text-xs text-ink-muted"
                        >
                          {expert}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2.5 text-xs leading-relaxed text-ink-subtle">
                      4 个专家常驻，单轮只命中 1 个；谁接手、调了什么、是否放行，面板里都能看到。
                    </p>
                  </div>
                </CardBody>
              </Card>
            </div>

            {/* 质量与边界 */}
            <div className="min-w-0 xl:col-span-4">
              <Card className="flex h-full flex-col">
                <CardHeader>
                  <CardTitle>质量与边界</CardTitle>
                </CardHeader>
                <CardBody className="flex flex-1 flex-col">
                  <ul className="space-y-3.5">
                    {QUALITY_ROWS.map((row) => (
                      <li key={row.label} className="space-y-0.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span
                            className={cn(
                              'text-xs text-ink-muted',
                              row.mono && 'font-mono text-[11px]',
                            )}
                          >
                            {row.label}
                          </span>
                          {row.badge ? (
                            <Badge tone="success">{row.badge}</Badge>
                          ) : (
                            <span className="text-sm font-semibold tabular-nums text-ink">
                              {row.value}
                            </span>
                          )}
                        </div>
                        {row.detail && (
                          <p className="text-[11px] leading-relaxed text-ink-subtle">
                            {row.detail}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-auto border-t border-line pt-3.5 sm:pt-4">
                    <p className="text-[11px] leading-relaxed text-ink-subtle">
                      演示使用本地 20 单种子数据，退款只改种子库，未接平台真实授权；接真实店铺时实现
                      DataProvider 契约即可。
                    </p>
                  </div>
                </CardBody>
              </Card>
            </div>
          </div>

          {/* 工具注册表 */}
          <section aria-labelledby="tools-heading">
            <Card>
              <CardHeader>
                <CardTitle id="tools-heading">工具注册表（10 个）</CardTitle>
                <span className="text-[11px] text-ink-subtle">MCP 暴露 4 个</span>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {TOOL_GROUPS.map((group) => (
                    <div key={group.label}>
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="text-xs font-semibold text-ink-muted">{group.label}</h3>
                        <span className="text-[11px] tabular-nums text-ink-subtle">
                          {group.tools.length} 个
                        </span>
                      </div>
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {group.tools.map((tool) => (
                          <li
                            key={tool.name}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-control border px-2 py-1 font-mono text-[11px] leading-none',
                              tool.mcp
                                ? 'border-brand-200 bg-brand-50 text-brand-700'
                                : 'border-line bg-surface-muted text-ink-muted',
                            )}
                          >
                            {tool.name}
                            {tool.mcp && (
                              <span className="rounded-full bg-brand-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-brand-700">
                                MCP
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-ink-subtle">
                  MCP 独立进程暴露其中 4 个：<span className="font-mono">kb_search</span> + 3
                  个运营向工具。
                </p>
              </CardBody>
            </Card>
          </section>

          {/* 演示路线 */}
          <section aria-labelledby="demo-heading" className="space-y-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id="demo-heading" className="text-sm font-semibold text-ink">
                演示路线
              </h2>
              <p className="text-[11px] text-ink-subtle">
                进入对话页后点对应「开始」即可复现。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {DEMO_ROUTES.map((route) => (
                <Card
                  key={route.no}
                  className="p-0 transition-colors hover:border-brand-200"
                >
                  <Link
                    href="/chat"
                    aria-label={`进入客服对话复现：${route.title}`}
                    className="group flex h-full flex-col rounded-card p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold tabular-nums text-brand-600">
                        {route.no}
                      </span>
                      <ArrowRightIcon className="h-3.5 w-3.5 text-ink-subtle transition-colors group-hover:text-brand-600" />
                    </div>
                    <p className="mt-1 text-sm font-semibold text-ink group-hover:text-brand-700">
                      {route.title}
                    </p>
                    <p className="mt-2 break-words rounded-control bg-surface-muted px-2 py-1.5 font-mono text-[11px] leading-relaxed text-ink-muted">
                      {route.prompt}
                    </p>
                    <p className="mt-auto pt-2 text-[11px] leading-relaxed text-ink-subtle">
                      {route.result}
                    </p>
                  </Link>
                </Card>
              ))}
            </div>
          </section>
        </div>
      </PageContainer>
    </main>
  );
}
