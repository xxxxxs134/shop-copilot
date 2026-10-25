"use client";

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
  const trendColor =
    trend === undefined
      ? ""
      : trend >= 0
        ? "text-emerald-600"
        : "text-red-500";
  const trendIcon = trend === undefined ? "" : trend >= 0 ? "↑" : "↓";

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-2xl font-bold text-slate-800">
        {typeof value === "number" ? value.toLocaleString() : value}
        {suffix && <span className="ml-0.5 text-sm font-normal text-slate-400">{suffix}</span>}
      </p>
      {trend !== undefined && (
        <p className={`text-xs ${trendColor}`}>
          {trendIcon} {Math.abs(trend)}%
        </p>
      )}
    </div>
  );
}
