'use client';

import { useState } from 'react';
import type { EscalationData } from '@/lib/escalateClient';

/**
 * 处理方案卡片（运营助手工具）
 *
 * 布局：emerald 主题头部 → 📋 情况摘要 → 💡 建议动作（浅底卡片）→ 📝 可复制话术（可复制文本块）。
 * 由 ChatWindow 在消息区以「系统消息式卡片」渲染；✕ 由父级清空状态关闭。
 */
export function EscalationCard({ data, onClose }: {
  data: EscalationData;
  onClose: () => void;
}) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  /** 复制话术：clipboard 不可用时降级隐藏 textarea（与 MessageActions 同法） */
  async function copyScript(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
      {/* 头部（emerald/teal 主题） */}
      <div className="flex items-center justify-between border-b border-emerald-200 bg-emerald-50 px-4 py-3">
        <h3 className="text-sm font-semibold text-emerald-800">📋 处理方案</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-emerald-500 transition hover:bg-emerald-100 hover:text-emerald-700"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      {/* 📋 情况摘要 */}
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="text-xs font-medium text-slate-500">📋 情况摘要</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
          {data.summary}
        </p>
      </div>

      {/* 💡 建议动作（浅底卡片） */}
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="text-xs font-medium text-slate-500">💡 建议动作</p>
        <ul className="mt-1.5 space-y-1.5">
          {data.suggestions.map((s, i) => (
            <li
              key={i}
              className="flex gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
            >
              <span aria-hidden>{s.icon}</span>
              <span className="text-sm leading-relaxed text-slate-700">{s.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 📝 可复制话术（可复制文本块） */}
      <div className="px-4 py-3">
        <p className="text-xs font-medium text-slate-500">📝 可复制话术</p>
        <div className="mt-1.5 space-y-2">
          {data.scripts.map((sc, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <span className="inline-block rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                {sc.scenario}
              </span>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {sc.text}
              </p>
              <div className="mt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => void copyScript(sc.text, i)}
                  className="rounded-md px-2 py-1 text-[11px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  title="复制话术"
                >
                  {copiedIdx === i ? '✓ 已复制' : '复制'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
