'use client';

import { Card } from './ui/Card';

/** 能力卡：icon / 标题 / 说明（title 提示）/ 点击发送的问题 */
interface Capability {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
  readonly question: string;
}

const CAPABILITIES: readonly Capability[] = [
  {
    icon: '🛍️',
    title: '售前推荐',
    description: '按预算和场景推荐商品，查库存与卖点',
    question: '200 元以内送父母的礼物，有什么推荐？',
  },
  {
    icon: '🚚',
    title: '拦截物流',
    description: '已发货但地址填错，确认后拦截在途包裹',
    question: 'SO20261027007 地址填错了，已经发货了，能帮我拦截吗？',
  },
  {
    icon: '🧾',
    title: '退款受阻',
    description: '退款被拒、超时或金额有争议时，查原因并给申诉路径',
    question: 'SO20261027011 的退款被拒了，为什么？我该怎么办？',
  },
  {
    icon: '😟',
    title: '投诉升级',
    description: '梳理情况、给建议、生成工单',
    question: '等了一周还没到，太失望了，我要投诉！',
  },
];

/** 能力卡（桌面 4 列 / 移动 2 列）：点击直接发送预设问题 */
export function ScenarioCards({
  onRun,
  disabled,
}: {
  onRun: (question: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
      {CAPABILITIES.map((c) => (
        <Card key={c.title} className="overflow-hidden p-0">
          <button
            type="button"
            onClick={() => onRun(c.question)}
            disabled={disabled}
            title={c.description}
            aria-label={`演示能力：${c.title}`}
            className="flex h-full w-full flex-col items-start gap-1 rounded-card p-2.5 text-left transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span
              aria-hidden="true"
              className="flex h-6 w-6 items-center justify-center rounded-control bg-brand-50 text-xs"
            >
              {c.icon}
            </span>
            <span className="text-xs font-semibold text-ink">{c.title}</span>
            <span
              className="w-full truncate text-[10px] text-ink-subtle"
              title={c.description}
            >
              {c.description}
            </span>
          </button>
        </Card>
      ))}
    </div>
  );
}
