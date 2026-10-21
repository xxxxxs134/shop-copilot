import type { UIMessage } from 'ai';

/**
 * 单条消息气泡
 *
 * AI SDK v5 起消息内容以 parts 数组承载（而非单一 content 字符串），
 * 这里只渲染 text 类型 part，后续里程碑将扩展 tool-invocation / 图片等 part。
 */
export function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={
          isUser
            ? 'max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2.5 text-sm text-white'
            : 'max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm'
        }
      >
        {message.parts.map((part, i) => {
          if (part.type === 'text') {
            return <span key={`${message.id}-${i}`}>{part.text}</span>;
          }
          return null;
        })}
      </div>
    </div>
  );
}
