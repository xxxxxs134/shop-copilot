'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

interface SidebarEntry {
  icon: string;
  label: string;
  href: string;
}

const NAV_ITEMS: readonly SidebarEntry[] = [
  { icon: '🏠', label: '工作台', href: '/workspace' },
  { icon: '💬', label: '对话', href: '/chat' },
  { icon: '📊', label: '数据', href: '/data' },
  { icon: '📦', label: '知识库', href: '/kb' },
];

export function WorkspaceSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="border-b border-line px-5 py-5">
        <p className="text-sm font-bold text-brand-700">店智 Copilot</p>
        <p className="mt-0.5 text-xs text-ink-subtle">运营工作台</p>
      </div>

      <nav className="space-y-1 px-2 py-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-control px-3 py-2 text-sm transition',
                active
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-ink-muted hover:bg-surface-muted',
              )}
            >
              <span className="shrink-0" aria-hidden="true">
                {item.icon}
              </span>
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-line px-5 py-3 text-xs leading-relaxed text-ink-subtle">
        AI 能力经 FastAPI 接入层，前端不直连模型。
      </div>
    </aside>
  );
}
