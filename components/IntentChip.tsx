import type { IntentInfo } from '@/lib/intentClient';
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

/**
 * 意图路由 chip（渲染在 user 消息气泡上方）
 *
 * 文案：`意图：数据查询 · 路由 → Agent 工具`
 * 后缀（§2.2 路由表，二选一）：
 * - 「已按意图切换」：RAG 模式按意图自动切到 Agent（intent.switched 由 ChatWindow 写入）
 * - 「RAG 模式可溯源」：Agent 模式下识别为 knowledge（用户显式选了 Agent，不回切）
 * `reason` 放 title 悬停可见，不占 chip 正文。
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

  return (
    <span
      title={intent.reason}
      className={`inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] leading-4 ${
        intent.switched
          ? 'border-amber-200 bg-amber-50 text-amber-700'
          : 'border-brand-100 bg-brand-50 text-brand-700'
      }`}
    >
      {label}
    </span>
  );
}
