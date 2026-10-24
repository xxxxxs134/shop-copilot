'use client';

import type { CitationSource } from '@/lib/sessionsClient';

/**
 * 引用溯源卡片（fixed 右下角）
 *
 * 点击回答中的 [n] 角标 → ChatWindow 拉取该轮 user 消息的 ragSearch 结果并缓存
 * → 这里展示第 n 项的 title/category/text 摘要。点遮罩或 × 关闭。
 */
export function CitationCard({
  index,
  source,
  loading,
  onClose,
}: {
  index: number;
  source: CitationSource | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {/* 遮罩：点击关闭 */}
      <div className="fixed inset-0 z-40 bg-slate-900/20" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label={`引用来源 [${index}]`}
        className="fixed bottom-6 right-6 z-50 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">
              {index}
            </span>
            <span className="text-xs font-medium text-slate-500">知识库来源</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {loading && (
          <p className="mt-3 animate-pulse text-sm text-slate-400">正在检索来源…</p>
        )}

        {!loading && source && (
          <div className="mt-3">
            <p className="text-sm font-semibold text-slate-800">{source.title}</p>
            <p className="mt-1 text-xs text-brand-600">{source.category}</p>
            <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600">
              {source.text.slice(0, 300)}
              {source.text.length > 300 ? '…' : ''}
            </p>
            {source.url && (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-brand-600 underline underline-offset-2 hover:text-brand-800"
              >
                查看原文
              </a>
            )}
          </div>
        )}

        {!loading && !source && (
          <p className="mt-3 text-sm text-slate-500">
            未找到第 {index} 条来源。该回答可能由 Agent 模式生成（检索为近似匹配），或知识库已更新。
          </p>
        )}
      </div>
    </>
  );
}
