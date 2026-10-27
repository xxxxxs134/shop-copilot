'use client';

/** 场景卡片数据：icon / 标题 / 简述（Agent 做什么）/ 点击预填的问题 */
interface Scenario {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
  readonly question: string;
}

const SCENARIOS: readonly Scenario[] = [
  {
    icon: '📦',
    title: '查订单',
    description: '查订单状态与物流进度，给出下一步建议',
    question: '帮我查一下 SO20261027010 的订单状态和物流进度',
  },
  {
    icon: '💰',
    title: '退款处理',
    description: '校验规则后预览执行退款，出售后回执',
    question: 'SO20261027016 这单客户要退 80 块，帮我处理一下',
  },
  {
    icon: '📊',
    title: '经营分析',
    description: '查经营数据出报表，给可执行改进建议',
    question: '帮我看看最近的经营数据，有什么需要改进的',
  },
  {
    icon: '📚',
    title: '规则问答',
    description: '检索知识库，有据可查地解答平台规则',
    question: 'DSR 评分是怎么算的？包含哪三项？',
  },
];

/**
 * 空状态场景快捷卡片（2×2）
 * 点击卡片 → onSelect(预设问题) 预填输入框，用户 Enter 发送
 */
export function ScenarioCards({ onSelect }: { onSelect: (question: string) => void }) {
  return (
    <div className="mx-auto max-w-md grid grid-cols-2 gap-3">
      {SCENARIOS.map((s) => (
        <button
          key={s.title}
          type="button"
          onClick={() => onSelect(s.question)}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-300 hover:shadow-sm cursor-pointer"
        >
          <span className="block text-2xl">{s.icon}</span>
          <span className="block mt-2 text-sm font-medium text-slate-800">{s.title}</span>
          <span className="block mt-0.5 text-xs text-slate-400">{s.description}</span>
        </button>
      ))}
    </div>
  );
}
