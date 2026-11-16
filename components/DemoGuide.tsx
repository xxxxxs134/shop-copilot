'use client';

import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { ScenarioCards } from './ScenarioCards';

/** 演示路线：编号 / 标题 / 可直接发送的问题 / 预期看到的结果 */
interface DemoRoute {
  readonly no: string;
  readonly title: string;
  readonly prompt: string;
  readonly expected: string;
}

const ROUTES: readonly DemoRoute[] = [
  {
    no: '01',
    title: '查订单',
    prompt: 'SO20261027009 到哪了？',
    expected: '订单卡 + 物流轨迹 + 预计到达',
  },
  {
    no: '02',
    title: '办退款',
    prompt: '订单 SO20261027001，帮我退 80 块',
    expected: '校验 → 客户确认 → 执行回执',
  },
  {
    no: '03',
    title: '投诉建单',
    prompt: '等了一周还没到，太失望了，我要投诉！',
    expected: '情绪识别 + 工单号 + 处理方案',
  },
];

const TECH_CHIPS: readonly string[] = [
  'LangGraph 6 节点',
  '8 个工具',
  'RAG 43 篇',
  '20 单演示数据',
];

const FLOW_STEPS: readonly string[] = [
  '路由判断意图',
  '专业 Agent 调工具',
  '终审校验防幻觉',
];

/**
 * 空状态演示向导：一句话价值主张 + 技术底牌 + 3 分钟演示路线 + 能力卡片 + 工作流
 * 点击「开始」直接发送预设问题，跳过「先输入再回车」的演示摩擦
 */
export function DemoGuide({
  onRun,
  busy,
}: {
  onRun: (question: string) => void;
  busy?: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3.5 py-2 text-center">
      {/* 价值主张 */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-brand-600">
          电商客服 Agent · 比赛演示
        </p>
        <h1 className="text-2xl font-semibold text-ink">不只是聊天，是能把事办完</h1>
        <p className="mx-auto max-w-xl text-sm leading-relaxed text-ink-muted">
          售前选品推荐、售后查单退款、投诉建单，全在一个对话框里完成。每一次工具调用、每一条知识引用，都能回查。
        </p>
      </div>

      {/* 技术底牌 */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {TECH_CHIPS.map((chip) => (
          <span
            key={chip}
            className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11px] text-ink-muted"
          >
            {chip}
          </span>
        ))}
      </div>

      {/* 工作流：一句话说明多 Agent 怎么跑 */}
      <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-ink-subtle">
        <span>工作方式：</span>
        {FLOW_STEPS.map((step, i) => (
          <span key={step} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">→</span>}
            <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-ink-muted">
              {step}
            </span>
          </span>
        ))}
      </div>

      {/* 演示路线标题 */}
      <div className="flex w-full items-baseline justify-between gap-2 px-0.5 pt-1">
        <h2 className="text-sm font-semibold text-ink">3 分钟演示路线</h2>
        <span className="text-[11px] text-ink-subtle">点「开始」直接发送</span>
      </div>

      {/* 演示路线：编号 + 问题 + 预期结果 + 开始按钮 */}
      <Card className="w-full overflow-hidden p-0">
        <div className="divide-y divide-line">
          {ROUTES.map((route) => (
            <div
              key={route.no}
              className="flex w-full flex-col gap-2 px-3.5 py-2.5 text-left sm:flex-row sm:items-center sm:gap-3"
            >
              <span className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-brand-50 text-[11px] font-semibold text-brand-600"
                >
                  {route.no}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{route.title}</span>
                  <span className="mt-1 block break-words rounded-control bg-surface-muted px-2 py-1 font-mono text-[11px] leading-relaxed text-ink-muted">
                    {route.prompt}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-ink-subtle">
                    {route.expected}
                  </span>
                </span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onRun(route.prompt)}
                disabled={busy}
                aria-label={`开始演示：${route.title}`}
                className="shrink-0 self-start sm:self-auto"
              >
                开始
              </Button>
            </div>
          ))}
        </div>
      </Card>

      {/* 能力卡片：点击直接发送 */}
      <ScenarioCards onRun={onRun} disabled={busy} />
    </div>
  );
}
