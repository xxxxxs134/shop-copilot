'use client';

import { Card } from './ui/Card';

/** 场景卡片数据：icon / 标题 / 简述（Agent 做什么）/ 点击预填的问题 */
interface Scenario {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
  readonly question: string;
}

const SCENARIOS: readonly Scenario[] = [
  {
    icon: '📊',
    title: '看数据',
    description: '拉 30 天经营快照，标出拖后腿的指标，给三条能马上做的动作',
    question: '帮我查一下最近 30 天的经营数据，GMV、转化率、退款率哪个拖后腿了',
  },
  {
    icon: '🔍',
    title: '查问题',
    description: '按状态捞出卡住的订单，定位问题出在哪一步，排出处理先后',
    question: '最近退款率涨了，帮我查一下是哪些订单卡在退款中',
  },
  {
    icon: '📋',
    title: '处理投诉',
    description: '查这单的状态和物流时效，给出可直接复制的回复，再生成处理方案',
    question: '客户投诉 SO20261027009 发货 7 天物流一直不动，帮我查下这单现在到哪了，该怎么回复',
  },
  {
    icon: '✍️',
    title: '写文案',
    description: '按商品卖点写标题、三条卖点和短描述，长度按平台限制收',
    question: '给纯棉基础款T恤写一个商品标题、三条卖点和一段短描述',
  },
];

/**
 * 空状态场景快捷卡片（2×2）
 * 点击卡片 → onSelect(预设问题) 预填输入框，用户 Enter 发送
 */
export function ScenarioCards({ onSelect }: { onSelect: (question: string) => void }) {
  return (
    <div className="mx-auto grid w-full max-w-2xl grid-cols-2 gap-3">
      {SCENARIOS.map((s) => (
        <Card key={s.title} className="overflow-hidden p-0">
          <button
            type="button"
            onClick={() => onSelect(s.question)}
            title={s.description}
            className="flex h-full w-full flex-col items-start gap-1.5 rounded-card p-4 text-left transition hover:bg-surface-muted"
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-control bg-brand-50 text-base"
            >
              {s.icon}
            </span>
            <span className="text-sm font-semibold text-ink">{s.title}</span>
            <span className="text-xs leading-relaxed text-ink-muted">{s.description}</span>
          </button>
        </Card>
      ))}
    </div>
  );
}
