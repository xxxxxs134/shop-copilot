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
      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-brand-300 hover:shadow-sm"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-lg">
        {icon}
      </span>
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {description && <p className="text-[11px] text-slate-400">{description}</p>}
      </div>
    </Link>
  );
}
