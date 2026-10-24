import { MarkdownText } from './MarkdownText';
import { MessageActions } from './MessageActions';

/**
 * 统一消息气泡（RAG / Agent 双模式共用）
 *
 * 与旧版差异：入口从 UIMessage 改为 {role, text} —— 由 ChatWindow 负责抽取文本，
 * assistant 侧接 MarkdownText（markdown 渲染 + [n] 角标）与 hover 操作条。
 */
export function MessageBubble({
  role,
  text,
  isLast,
  busy,
  onCite,
  onRegenerate,
}: {
  role: 'user' | 'assistant';
  text: string;
  /** 是否为当前模式下的最后一条消息（决定是否显示「重新生成」） */
  isLast: boolean;
  /** 生成中：禁用重新生成 */
  busy: boolean;
  onCite: (n: number) => void;
  onRegenerate: () => void;
}) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2.5 text-sm text-white">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex justify-start">
      <div className="max-w-[80%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <MarkdownText text={text} onCite={onCite} />
        <MessageActions text={text} isLast={isLast} disabled={busy} onRegenerate={onRegenerate} />
      </div>
    </div>
  );
}
