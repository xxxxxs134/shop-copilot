"use client";

export function RecentSession({
  title,
  mode,
  updatedAt,
  onClick,
}: {
  title: string;
  mode: string;
  updatedAt: number;
  onClick: () => void;
}) {
  const timeStr = updatedAt
    ? new Date(updatedAt * 1000).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const modeColor = mode === "agent" ? "bg-purple-100 text-purple-600" : "bg-blue-100 text-blue-600";

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition hover:bg-slate-50"
    >
      <div className="flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${modeColor}`}>
          {mode.toUpperCase()}
        </span>
        <span className="truncate text-sm text-slate-700">{title}</span>
      </div>
      <span className="shrink-0 text-[11px] text-slate-400">{timeStr}</span>
    </button>
  );
}
