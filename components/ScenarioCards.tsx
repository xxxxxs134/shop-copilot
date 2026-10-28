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
    icon: '📊',
    title: '看数据',
    description: '今日经营分析+异常点定位',
    question: '今天经营情况怎么样？有什么需要关注的',
  },
  {
    icon: '🔍',
    title: '查问题',
    description: '退款率异常归因+处理建议',
    question: '最近退款率好像涨了，帮我分析一下原因和该怎么处理',
  },
  {
    icon: '📋',
    title: '处理投诉',
    description: '查上下文+生成处理方案',
    question: '有客户投诉 SO20261027017 延迟发货，帮我分析一下该怎么回复处理',
  },
  {
    icon: '✍️',
    title: '写文案',
    description: '商品标题+卖点+描述',
    question: '给纯棉基础款T恤写一个商品标题和卖点',
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
