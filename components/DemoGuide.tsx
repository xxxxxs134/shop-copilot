'use client';

import Link from 'next/link';
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
    title: '拦截物流',
    prompt: 'SO20261027007 地址填错了，已经发货了，能帮我拦截吗？',
    expected: '订单信息 + 拦截确认 → 输入「确认拦截」执行',
  },
  {
    no: '02',
    title: '售后异常',
    prompt: 'SO20261027011 的退款被拒了，为什么？我该怎么办？',
    expected: '售后状态 + 政策依据 + 申诉建议',
  },
  {
    no: '03',
    title: '投诉建单',
    prompt: '等了一周还没到，太失望了，我要投诉！',
    expected: '情绪识别 + 工单号 + 处理方案',
  },
];

/** 「四步把事办完」四步：编号 / 标题 / 一句话说明 */
interface WhyStep {
  readonly no: string;
  readonly title: string;
  readonly detail: string;
}

const WHY_STEPS: readonly WhyStep[] = [
  {
    no: '01',
    title: '先弄明白你要办什么',
    detail: '查订单、办售后、投诉，先分清楚再回答',
  },
  {
    no: '02',
    title: '查真实数据',
    detail: '订单、商品、政策都现场查，不编答案',
  },
  {
    no: '03',
    title: '有据才回答',
    detail: '没证据就直说；有引用点开可核对原文',
  },
  {
    no: '04',
    title: '给出结果和下一步',
    detail: '能办的给回执，办不了的给清楚路径',
  },
];

/** 能力行：标签 / 说明 */
interface CapabilityRow {
  readonly label: string;
  readonly value: string;
}

const CAPABILITY_ROWS: readonly CapabilityRow[] = [
  { label: '确认后办理', value: '改地址 / 拦截 / 退换，你确认了才执行' },
  { label: '有据可查', value: '回答带 [n]，点开可看原文' },
];

/**
 * 空状态演示向导：一句话价值主张 + 三条高频任务 + 能力卡片 + 办理流程
 * 点击「开始」直接发送预设问题，跳过「先输入再回车」的演示摩擦
 * ≥lg 两栏：左侧路线 + 能力卡，右侧「四步把事办完」说明卡
 */
export function DemoGuide({
  onRun,
  busy,
}: {
  onRun: (question: string) => void;
  busy?: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3.5 py-2 text-center">
      {/* 价值主张 */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-brand-600">
          电商智能客服
        </p>
        <h1 className="text-2xl font-semibold text-ink">不只是聊天，是能把事办完</h1>
        <p className="mx-auto max-w-xl text-sm leading-relaxed text-ink-muted">
          售前选品推荐、售后查单与受阻诊断、投诉建单，全在一个对话框里完成。每条回答都有据可查。
        </p>
      </div>

      {/* 桌面两栏（<lg 单列：路线在前，机制卡在后） */}
      <div className="mt-1 grid w-full gap-4 text-left lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)] lg:items-start">
        {/* 左栏：三条高频任务 + 能力卡片 */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex w-full items-baseline justify-between gap-2 px-0.5">
            <h2 className="text-sm font-semibold text-ink">三条高频任务</h2>
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

        {/* 右栏：四步把事办完 */}
        <Card className="w-full overflow-hidden p-0">
          <div className="flex h-full flex-col p-4">
            <h2 className="text-sm font-semibold text-ink">四步把事办完</h2>

            <ol className="mt-3 space-y-2.5">
              {WHY_STEPS.map((step) => (
                <li key={step.no} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand-600"
                  >
                    {step.no}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-ink">{step.title}</span>
                    <span className="mt-0.5 block break-words text-[11px] leading-relaxed text-ink-muted">
                      {step.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ol>

            <div className="mt-3 divide-y divide-line border-t border-line pt-3">
              {CAPABILITY_ROWS.map((row) => (
                <div
                  key={row.label}
                  className="flex items-start justify-between gap-2 py-2"
                >
                  <span className="shrink-0 text-[11px] font-medium text-ink">{row.label}</span>
                  <span className="min-w-0 break-words text-right font-mono text-[11px] leading-relaxed text-ink-muted">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-3 border-t border-line pt-3">
              <Link
                href="/overview"
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                查看系统概览 <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
