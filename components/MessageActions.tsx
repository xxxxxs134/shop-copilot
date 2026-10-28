'use client';

import { useState } from 'react';

/**
 * assistant 消息 hover 操作条：复制 / 重新生成
 *
 * 重新生成只在「最后一条 assistant」上显示（由 isLast 控制），
 * RAG 模式走 useChat.regenerate()，Agent 模式重跑最后一条 user 消息。
 */
export function MessageActions({
  text,
  isLast,
  disabled,
  onRegenerate,
}: {
  text: string;
  isLast: boolean;
  disabled: boolean;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用（非 HTTPS 等）：降级用隐藏 textarea
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="mt-1.5 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
      <button
        type="button"
        onClick={handleCopy}
        className="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        title="复制回答"
      >
        {copied ? '✓ 已复制' : '复制'}
      </button>
      {isLast && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={disabled}
          className="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
          title="重新生成这条回答"
        >
          重新生成
        </button>
      )}
    </div>
  );
}
