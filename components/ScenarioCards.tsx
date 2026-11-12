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
    icon: '🛍️',
    title: '咨询商品',
    description: '问价格、库存、推荐，帮你挑到合适的',
    question: '你们有什么适合送父母的礼物吗？',
  },
  {
    icon: '📦',
    title: '查订单',
    description: '查询订单和物流进度，看看到哪了',
    question: '我的订单到哪了？',
  },
  {
    icon: '💰',
    title: '退款退货',
    description: '申请退款或退货，说明情况即可',
    question: '我收到的商品有问题，想退货，怎么操作？',
  },
  {
    icon: '😟',
    title: '投诉建议',
    description: '有不满或建议都可以说，我会帮你反馈',
    question: '我想投诉，怎么联系你们？',
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
