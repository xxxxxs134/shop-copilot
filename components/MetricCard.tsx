'use client';

import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

export function MetricCard({
  label,
  value,
  trend,
  suffix,
}: {
  label: string;
  value: number | string;
  trend?: number;
  suffix?: string;
}) {
  const trendColor = trend === undefined ? '' : trend >= 0 ? 'text-success' : 'text-danger';
  const trendIcon = trend === undefined ? '' : trend >= 0 ? '↑' : '↓';

  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs text-ink-subtle">{label}</p>
      <p className="text-2xl font-bold text-ink">
        {typeof value === 'number' ? value.toLocaleString() : value}
        {suffix && <span className="ml-0.5 text-sm font-normal text-ink-subtle">{suffix}</span>}
      </p>
      {trend !== undefined && (
        <p className={cn('text-xs', trendColor)}>
          {trendIcon} {Math.abs(trend)}%
        </p>
      )}
    </Card>
  );
}
