"use client";

import Link from "next/link";

export function QuickAction({
  icon,
  label,
  href,
  description,
}: {
  icon: string;
  label: string;
  href: string;
  description?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-slate-50"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-base">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-700">{label}</p>
        {description && <p className="truncate text-xs text-slate-400">{description}</p>}
      </div>
    </Link>
  );
}
