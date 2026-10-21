'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useMemo, useState } from 'react';
import { MessageBubble } from './MessageBubble';

/**
 * 聊天主窗口（客户端组件）
 *
 * 核心能力（M0）：
 * - 流式对话：通过 useChat + DefaultChatTransport 连接 /api/chat
 * - 状态管理：submitted/streaming 时展示「思考中」，错误内联展示不白屏
 * - 交互：Enter 发送、Shift+Enter 换行、生成中可停止
 */
export function ChatWindow() {
  const [input, setInput] = useState('');

  // transport 只需创建一次，避免重复实例化
  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat' }), []);

  const { messages, sendMessage, status, error, stop, regenerate } = useChat({ transport });

  const busy = status === 'submitted' || status === 'streaming';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    await sendMessage({ text });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <div className="mx-auto flex h-screen w-full max-w-3xl flex-col px-4">
      {/* 顶栏 */}
      <header className="flex items-center justify-between border-b border-slate-200 py-4">
        <div>
          <h1 className="text-lg font-bold text-brand-700">店智 Copilot</h1>
          <p className="text-xs text-slate-500">电商运营 AI 智能助手 · M0 Demo</p>
        </div>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700">DeepSeek</span>
      </header>

      {/* 消息列表 */}
      <div className="flex-1 space-y-4 overflow-y-auto py-6">
        {messages.length === 0 && (
          <div className="mt-20 text-center text-slate-400">
            <p className="text-4xl">🛒</p>
            <p className="mt-3 text-sm">试着问我：如何写出高点击率的商品标题？</p>
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {/* 思考中指示器 */}
        {status === 'submitted' && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-slate-400" />
            店智思考中…
          </div>
        )}
      </div>

      {/* 错误内联提示 */}
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">出错了</p>
          <p className="mt-1 break-all">{error.message || '请求失败，请稍后重试'}</p>
          <button
            type="button"
            onClick={() => void regenerate()}
            className="mt-2 text-red-600 underline underline-offset-2 hover:text-red-800"
          >
            重试
          </button>
        </div>
      )}

      {/* 输入区 */}
      <form onSubmit={handleSubmit} className="border-t border-slate-200 py-4">
        <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-brand-500">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的电商运营问题，Enter 发送…"
            rows={2}
            className="flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-slate-400"
          />
          {busy ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
            >
              停止
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
