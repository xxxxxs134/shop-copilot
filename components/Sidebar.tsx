'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { SessionId, SessionMeta, SessionMode } from '@/lib/sessionsClient';

/**
 * 会话侧边栏（展开 240px / 折叠 56px）
 *
 * 职责：会话列表（mode 徽章/更新时间）、新建会话、行内改名、两步删除确认。
 * 数据与持久化逻辑都在 ChatWindow（会话状态机）里，本组件纯展示 + 事件回调。
 * <lg 展开时以抽屉形式覆盖内容区，点遮罩关闭。
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
      <aside className="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-line bg-surface py-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          aria-label="展开会话列表"
          className="h-9 w-9 p-0"
        >
          ☰
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onCreate}
          disabled={busy}
          aria-label="新建会话"
          className="h-9 w-9 p-0"
        >
          ＋
        </Button>
      </aside>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label="关闭会话列表"
        onClick={onToggle}
        className="fixed inset-0 z-30 bg-ink/30 backdrop-blur-sm lg:hidden"
      />
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-sm font-bold text-brand-700">会话</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            aria-label="收起会话列表"
            className="h-8 w-8 p-0"
          >
            ☰
          </Button>
        </div>

        <div className="px-3 py-3">
          <Button variant="primary" onClick={onCreate} disabled={busy} className="w-full">
            ＋ 新建会话
          </Button>
          <p className="mt-1.5 text-center text-xs text-ink-subtle">
            新会话将以当前模式（{mode === 'rag' ? 'RAG 问答' : 'Agent'}）创建
          </p>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {sessions.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-ink-subtle">暂无会话</p>
          )}
          {sessions.map((s) => {
            const active = s.id === activeId;
            const editing = editingId === s.id;
            const confirming = confirmDeleteId === s.id;
            return (
              <div
                key={s.id}
                className={cn(
                  'group relative rounded-control px-2 py-2 transition',
                  active ? 'bg-brand-50' : 'hover:bg-surface-muted',
                )}
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
                    className="w-full rounded-control border border-brand-300 bg-surface px-1.5 py-0.5 text-sm outline-none"
                  />
                ) : confirming ? (
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs text-danger">删除该会话？</span>
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          onDelete(s.id);
                          setConfirmDeleteId(null);
                        }}
                        className="rounded bg-danger px-1.5 py-0.5 text-xs text-white hover:bg-red-700"
                      >
                        删除
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded bg-surface-subtle px-1.5 py-0.5 text-xs text-ink-muted hover:bg-line"
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
                      <Badge tone={s.mode === 'rag' ? 'info' : 'brand'}>
                        {s.mode === 'rag' ? 'RAG' : 'AGENT'}
                      </Badge>
                      <span
                        className={cn(
                          'truncate text-sm',
                          active ? 'font-medium text-brand-700' : 'text-ink',
                        )}
                      >
                        {s.title}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-subtle">
                      {formatTime(s.updated_at)}
                    </span>
                  </button>
                )}

                {!editing && !confirming && (
                  <span className="absolute right-1.5 top-2 hidden gap-0.5 group-hover:flex">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(s.id);
                        setDraftTitle(s.title);
                      }}
                      title="重命名"
                      className="rounded p-1 text-ink-subtle transition hover:bg-surface hover:text-brand-600"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(s.id)}
                      title="删除"
                      className="rounded p-1 text-ink-subtle transition hover:bg-surface hover:text-danger"
                    >
                      🗑
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-line px-4 py-3 text-xs leading-relaxed text-ink-subtle">
          会话本地持久化（data/app.db），刷新不丢失。
          <br />
          AI 能力经 FastAPI 接入层，前端不直连模型。
        </div>
      </aside>
    </>
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
