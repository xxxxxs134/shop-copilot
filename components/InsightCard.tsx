'use client';

import { cn } from '@/lib/cn';

const TYPE_STYLES: Record<string, string> = {
  warning: 'border-l-warning bg-amber-50',
  info: 'border-l-info bg-sky-50',
  suggestion: 'border-l-success bg-emerald-50',
};

export function InsightCard({
  icon,
  text,
  type,
}: {
  icon: string;
  text: string;
  type: string;
}) {
  const s = TYPE_STYLES[type] ?? 'border-l-line bg-surface-muted';
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-card border border-line border-l-4 px-3 py-2.5',
        s,
      )}
    >
      <span className="text-base leading-6" aria-hidden="true">
        {icon}
      </span>
      <p className="text-sm leading-6 text-ink">{text}</p>
    </div>
  );
}
