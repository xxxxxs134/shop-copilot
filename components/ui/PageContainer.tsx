import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('mx-auto w-full max-w-7xl px-6 py-6', className)}>{children}</div>;
}
