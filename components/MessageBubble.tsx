import { MarkdownText } from './MarkdownText';
import { MessageActions } from './MessageActions';
import { EmpathyBanner, IntentChip } from './IntentChip';
import type { IntentInfo } from '@/lib/intentClient';
import type { SessionMode } from '@/lib/sessionsClient';

/**
 * 统一消息气泡（RAG / Agent 双模式共用）
 *
 * 与旧版差异：入口从 UIMessage 改为 {role, text} —— 由 ChatWindow 负责抽取文本，
 * assistant 侧接 MarkdownText（markdown 渲染 + [n] 角标）与 hover 操作条。
 * P5 §2.2：user 侧气泡上方渲染意图 chip（老会话消息无 intent 字段 → 不渲染）。
 * 情绪增强：user 侧 chip 下渲染实体标签 + 情绪徽章；assistant 侧回复上方渲染负向情绪共情 banner。
 */
export function MessageBubble({
  role,
  text,
  isLast,
  busy,
  onCite,
  onRegenerate,
  intent,
  mode,
}: {
  role: 'user' | 'assistant';
  text: string;
  /** 是否为当前模式下的最后一条消息（决定是否显示「重新生成」） */
  isLast: boolean;
  /** 生成中：禁用重新生成 */
  busy: boolean;
  onCite: (n: number) => void;
  onRegenerate: () => void;
  /** 本轮 user 消息的意图识别结果；user 侧渲染 chip，assistant 侧据情绪渲染共情 banner */
  intent?: IntentInfo;
  /** 当前会话模式（chip 后缀判定：Agent 模式下 knowledge 注明「RAG 模式可溯源」） */
  mode: SessionMode;
}) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[80%] flex-col items-end gap-1">
          {intent && <IntentChip intent={intent} mode={mode} />}
          <div className="max-w-full whitespace-pre-wrap rounded-card rounded-br-sm bg-brand-600 px-4 py-2.5 text-sm text-white">
            {text}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col items-start gap-2">
      <EmpathyBanner sentiment={intent?.sentiment} />
      <div className="max-w-[80%] rounded-card rounded-bl-sm border border-line bg-surface px-4 py-2.5 shadow-card">
        <MarkdownText text={text} onCite={onCite} />
        <MessageActions text={text} isLast={isLast} disabled={busy} onRegenerate={onRegenerate} />
      </div>
    </div>
  );
}
