'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionId, SessionMeta, SessionMode } from '@/lib/sessionsClient';

/**
 * 会话侧边栏（左 260px，可折叠）
 *
 * 职责：会话列表（mode 徽章/更新时间）、新建会话、行内改名、两步删除确认。
 * 数据与持久化逻辑都在 ChatWindow（会话状态机）里，本组件纯展示 + 事件回调。
 */
export function Sidebar({
  sessions,
  activeId,
  mode,
  collapsed,
  busy,
  onToggle,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  sessions: SessionMeta[];
  activeId: SessionId | null;
  mode: SessionMode;
  collapsed: boolean;
  /** 有请求在途时禁用新建/删除，防止并发覆盖 */
  busy: boolean;
  onToggle: () => void;
  onSelect: (id: SessionId) => void;
  onCreate: () => void;
  onRename: (id: SessionId, title: string) => void;
  onDelete: (id: SessionId) => void;
}) {
  const [editingId, setEditingId] = useState<SessionId | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<SessionId | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const kbActive = pathname === '/kb';

  // 进入编辑态自动聚焦
  useEffect(() => {
    if (editingId !== null) editInputRef.current?.focus();
  }, [editingId]);

  function commitRename() {
    if (editingId === null) return;
    const title = draftTitle.trim();
    if (title) onRename(editingId, title);
    setEditingId(null);
  }

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-3 border-r border-slate-200 bg-white py-4">
        <button
          type="button"
          onClick={onToggle}
          title="展开会话列表"
          className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
        >
          ☰
        </button>
        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          title="新建会话"
          className="rounded-lg bg-brand-600 p-2 text-white transition hover:bg-brand-700 disabled:opacity-40"
        >
          ＋
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-slate-200 bg-white">
      {/* 头部：标题 + 折叠 */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <p className="text-sm font-bold text-brand-700">店智 Copilot</p>
          <p className="text-[11px] text-slate-400">会话历史</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          title="收起侧边栏"
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          ☰
        </button>
      </div>

      {/* 新建会话 */}
      <div className="px-3 py-3">
        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ＋ 新建会话
        </button>
        <p className="mt-1.5 text-center text-[10px] text-slate-400">
          新会话将以当前模式（{mode === 'rag' ? 'RAG 问答' : 'Agent'}）创建
        </p>
      </div>

      {/* 会话列表 */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {sessions.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-slate-400">暂无会话</p>
        )}
        {sessions.map((s) => {
          const active = s.id === activeId;
          const editing = editingId === s.id;
          const confirming = confirmDeleteId === s.id;
          return (
            <div
              key={s.id}
              className={`group relative rounded-lg px-2 py-2 transition ${
                active ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50'
              }`}
            >
              {editing ? (
                <input
                  ref={editInputRef}
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="w-full rounded border border-brand-300 bg-white px-1.5 py-0.5 text-sm outline-none"
                />
              ) : confirming ? (
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs text-red-600">删除该会话？</span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(s.id);
                        setConfirmDeleteId(null);
                      }}
                      className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] text-white hover:bg-red-700"
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200"
                    >
                      取消
                    </button>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  className="block w-full text-left"
                  title={s.title}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${
                        s.mode === 'rag'
                          ? 'bg-sky-100 text-sky-700'
                          : 'bg-violet-100 text-violet-700'
                      }`}
                    >
                      {s.mode === 'rag' ? 'RAG' : 'AGENT'}
                    </span>
                    <span className={`truncate text-sm ${active ? 'font-medium text-brand-800' : 'text-slate-700'}`}>
                      {s.title}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[10px] text-slate-400">
                    {formatTime(s.updated_at)}
                  </span>
                </button>
              )}

              {/* 行内操作：改名 / 删除（hover 显示，编辑/确认态隐藏） */}
              {!editing && !confirming && (
                <span className="absolute right-1.5 top-2 hidden gap-0.5 group-hover:flex">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(s.id);
                      setDraftTitle(s.title);
                    }}
                    title="重命名"
                    className="rounded p-1 text-slate-400 transition hover:bg-white hover:text-brand-600"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(s.id)}
                    title="删除"
                    className="rounded p-1 text-slate-400 transition hover:bg-white hover:text-red-600"
                  >
                    🗑
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </nav>

      {/* 知识库入口（P5 §4.2，底部导航） */}
      <div className="border-t border-slate-200 px-2 py-2">
        <Link
          href="/kb"
          className={`flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition ${
            kbActive
              ? 'bg-brand-50 font-medium text-brand-800 ring-1 ring-brand-200'
              : 'text-slate-700 hover:bg-slate-50'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 ${kbActive ? 'text-brand-600' : 'text-slate-400'}`}
          >
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
          </svg>
          <span className="truncate">知识库</span>
          <span className="ml-auto shrink-0 text-[10px] text-slate-400">文档 · 切片</span>
        </Link>
      </div>

      {/* 底部说明 */}
      <div className="border-t border-slate-200 px-4 py-3 text-[10px] leading-relaxed text-slate-400">
        会话本地持久化（data/app.db），刷新不丢失。
        <br />
        AI 能力经 FastAPI 接入层，前端不直连模型。
      </div>
    </aside>
  );
}

/** updated_at（epoch 秒）→ 相对时间（今天显示 HH:MM，昨天显示"昨天"，否则 MM-DD） */
function formatTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return `${d.getMonth() + 1}-${pad(d.getDate())}`;
}
