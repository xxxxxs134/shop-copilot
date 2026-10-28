'use client';

import { Badge } from '@/components/ui/Badge';

export function RecentSession({
  title,
  mode,
  updatedAt,
  onClick,
}: {
  title: string;
  mode: string;
  updatedAt: number;
  onClick: () => void;
}) {
  const timeStr = updatedAt
    ? new Date(updatedAt * 1000).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 items-center justify-between gap-2 rounded-control px-3 py-2 text-left transition hover:bg-surface-muted"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Badge tone={mode === 'agent' ? 'brand' : 'info'}>{mode.toUpperCase()}</Badge>
        <span className="min-w-0 truncate text-sm text-ink">{title}</span>
      </div>
      <span className="shrink-0 whitespace-nowrap text-xs text-ink-subtle">{timeStr}</span>
    </button>
  );
}
