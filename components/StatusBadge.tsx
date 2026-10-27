"use client";

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  unpaid: { label: "未付", color: "bg-slate-100 text-slate-500" },
  paid: { label: "已付", color: "bg-blue-100 text-blue-600" },
  shipped: { label: "已发", color: "bg-purple-100 text-purple-600" },
  received: { label: "已收", color: "bg-emerald-100 text-emerald-600" },
  refunding: { label: "退款中", color: "bg-yellow-100 text-yellow-700" },
  rejected: { label: "被拒", color: "bg-red-100 text-red-600" },
  被拒: { label: "被拒", color: "bg-red-100 text-red-600" },
  refunded: { label: "已退款", color: "bg-slate-100 text-slate-500" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, color: "bg-slate-100 text-slate-500" };
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${s.color}`}>
      {s.label}
    </span>
  );
}
