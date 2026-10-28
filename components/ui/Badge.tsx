import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import type { Tone } from '@/lib/status';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-subtle text-ink-muted',
  brand: 'bg-brand-50 text-brand-700',
  info: 'bg-sky-50 text-info',
  success: 'bg-emerald-50 text-success',
  warning: 'bg-amber-50 text-warning',
  danger: 'bg-red-50 text-danger',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
