import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function EmptyState({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-10 text-center', className)}>
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink-subtle">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
