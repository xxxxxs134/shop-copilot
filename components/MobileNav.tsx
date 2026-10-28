'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const NAV_ITEMS = [
  { icon: '🏠', label: '工作台', href: '/workspace' },
  { icon: '💬', label: '对话', href: '/chat' },
  { icon: '📊', label: '数据', href: '/data' },
  { icon: '📦', label: '知识库', href: '/kb' },
] as const;

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="主导航"
      className="flex h-14 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-3 md:hidden"
    >
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-control px-3 py-2 text-sm transition',
              active
                ? 'bg-brand-50 font-medium text-brand-700'
                : 'text-ink-muted hover:bg-surface-muted',
            )}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
