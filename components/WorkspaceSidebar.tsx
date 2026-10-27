'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * 运营工作台左侧导航栏（240px 固定宽，整屏高）
 *
 * 职责：品牌标题、主导航（工作台/对话/数据/知识库）。
 * 纯展示组件，无业务状态；样式沿用 chat 侧边栏（Sidebar.tsx）的
 * brand/slate 令牌与 active ring 态。
 */

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
    <aside className="sticky top-0 flex h-screen w-[240px] shrink-0 flex-col border-r border-slate-200 bg-white">
      {/* 头部：品牌 + 页面名 */}
      <div className="border-b border-slate-200 px-4 py-4">
        <p className="text-sm font-bold text-brand-700">店智 Copilot</p>
        <p className="text-[11px] text-slate-400">运营工作台</p>
      </div>

      {/* 主导航 */}
      <nav className="space-y-1 px-2 py-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition ${
                active
                  ? 'bg-brand-50 font-medium text-brand-800 ring-1 ring-brand-200'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="shrink-0" aria-hidden="true">
                {item.icon}
              </span>
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* 底部说明（与 chat 侧边栏一致的脚注风格） */}
      <div className="mt-auto border-t border-slate-200 px-4 py-3 text-[10px] leading-relaxed text-slate-400">
        AI 能力经 FastAPI 接入层，前端不直连模型。
      </div>
    </aside>
  );
}
