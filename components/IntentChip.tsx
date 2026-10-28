import type { IntentInfo, Sentiment } from '@/lib/intentClient';
import type { SessionMode } from '@/lib/sessionsClient';

/** intent → 中文标签（§2.2 chip 文案）；未登记的值原样展示 */
const INTENT_LABELS: Record<string, string | undefined> = {
  knowledge: '知识问答',
  data: '数据查询',
  policy: '合规检查',
  copywriting: '文案创作',
  general: '通用',
};

/** target → 路由目标标签 */
const TARGET_LABELS: Record<string, string | undefined> = {
  rag: '→ 检索',
  agent: '→ Agent 工具',
};

/** 实体类型 → 图标；未登记类型用 🏷️ 兜底 */
const ENTITY_ICONS: Record<string, string | undefined> = {
  order_id: '📦',
  product: '🛍️',
  reason: '📋',
  amount: '💰',
  time_expr: '🕐',
  action: '⚡',
};

/** 情绪标签 → 徽章展示（图标 + 中文 + 配色 + 是否负向） */
interface SentimentMeta {
  icon: string;
  display: string;
  className: string;
  negative: boolean;
}

const ANGRY: SentimentMeta = {
  icon: '😠',
  display: '愤怒',
  className: 'bg-red-100 text-red-700',
  negative: true,
};
const ANXIOUS: SentimentMeta = {
  icon: '😰',
  display: '焦虑',
  className: 'bg-amber-100 text-amber-700',
  negative: true,
};
const FRUSTRATED: SentimentMeta = {
  icon: '😤',
  display: '无奈',
  className: 'bg-orange-100 text-orange-700',
  negative: true,
};
const NEUTRAL: SentimentMeta = {
  icon: '😐',
  display: '中性',
  className: 'bg-slate-100 text-slate-500',
  negative: false,
};
const POSITIVE: SentimentMeta = {
  icon: '😊',
  display: '正向',
  className: 'bg-emerald-100 text-emerald-700',
  negative: false,
};

/** label → 徽章元数据（兼容中文键）；未登记值按中性兜底并原样展示 */
const SENTIMENT_META: Record<string, SentimentMeta | undefined> = {
  angry: ANGRY,
  愤怒: ANGRY,
  anxious: ANXIOUS,
  焦虑: ANXIOUS,
  frustrated: FRUSTRATED,
  无奈: FRUSTRATED,
  neutral: NEUTRAL,
  中性: NEUTRAL,
  positive: POSITIVE,
  正向: POSITIVE,
};

function sentimentMeta(label: string): SentimentMeta {
  return SENTIMENT_META[label] ?? { ...NEUTRAL, display: label };
}

/**
 * 意图路由 chip + 实体/情绪增强（渲染在 user 消息气泡上方）
 *
 * 主 chip 文案：`意图：数据查询 · 路由 → Agent 工具`
 * 后缀（§2.2 路由表，二选一）：
 * - 「已按意图切换」：RAG 模式按意图自动切到 Agent（intent.switched 由 ChatWindow 写入）
 * - 「RAG 模式可溯源」：Agent 模式下识别为 knowledge（用户显式选了 Agent，不回切）
 * `reason` 放 title 悬停可见，不占 chip 正文。
 *
 * 主 chip 下方 flex-wrap 行：实体小标签（icon + 值）+ 末尾情绪徽章（老数据无此二字段 → 不渲染）。
 */
export function IntentChip({ intent, mode }: { intent: IntentInfo; mode: SessionMode }) {
  const intentLabel = INTENT_LABELS[intent.intent] ?? intent.intent;
  const targetLabel = TARGET_LABELS[intent.target] ?? `→ ${intent.target}`;
  const suffix = intent.switched
    ? '已按意图切换'
    : intent.intent === 'knowledge' && mode === 'agent'
      ? 'RAG 模式可溯源'
      : null;

  const label = `意图：${intentLabel} · 路由 ${targetLabel}${suffix ? ` · ${suffix}` : ''}`;
  const entities = Object.entries(intent.entities ?? {});
  const meta = intent.sentiment ? sentimentMeta(intent.sentiment.label) : null;

  return (
    <div className="flex max-w-full flex-col items-end gap-1">
      <span
        title={intent.reason}
        className={`inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-xs leading-4 ${
          intent.switched
            ? 'border-amber-200 bg-amber-50 text-amber-700'
            : 'border-brand-100 bg-brand-50 text-brand-700'
        }`}
      >
        {label}
      </span>
      {(entities.length > 0 || meta) && (
        <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
          {entities.map(([type, value]) => (
            <span
              key={type}
              title={type}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs leading-4 text-slate-600"
            >
              <span aria-hidden="true">{ENTITY_ICONS[type] ?? '🏷️'}</span>
              {value}
            </span>
          ))}
          {intent.sentiment && meta && (
            <span
              title={`情绪置信度 ${intent.sentiment.score}${
                intent.sentiment.cues.length > 0
                  ? ` · 触发：${intent.sentiment.cues.join('、')}`
                  : ''
              }`}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs leading-4 ${meta.className}`}
            >
              <span aria-hidden="true">{meta.icon}</span>
              {meta.display}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 负向情绪共情 banner（渲染在 assistant 回复上方）：
 * `💙 检测到客户情绪（焦虑），已优先安抚处理`
 * 仅 angry / anxious / frustrated 渲染；无情绪或非负向 → null。
 */
export function EmpathyBanner({ sentiment }: { sentiment?: Sentiment }) {
  if (!sentiment) return null;
  const meta = sentimentMeta(sentiment.label);
  if (!meta.negative) return null;
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
      💙 检测到客户情绪（{meta.display}），已优先安抚处理
    </div>
  );
}
