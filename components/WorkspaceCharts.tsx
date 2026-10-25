"use client";

export function BarChart({ items }: { items: Array<{ label: string; value: number; suffix?: string }> }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-20 shrink-0 truncate text-xs text-slate-500">{item.label}</span>
          <div className="flex-1">
            <div className="h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-brand-500"
                style={{ width: `${(item.value / max) * 100}%` }}
              />
            </div>
          </div>
          <span className="w-14 shrink-0 text-right text-xs text-slate-600">
            {item.value.toLocaleString()}{item.suffix ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export function KbStats({ docCount, chunkCount, retrievalScore }: { docCount: number; chunkCount: number; retrievalScore: number }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-center">
        <p className="text-lg font-bold text-slate-800">{docCount}</p>
        <p className="text-[10px] text-slate-400">知识文档</p>
      </div>
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-center">
        <p className="text-lg font-bold text-slate-800">{chunkCount}</p>
        <p className="text-[10px] text-slate-400">检索切片</p>
      </div>
      <div className="rounded-lg bg-emerald-50 px-3 py-2 text-center">
        <p className="text-lg font-bold text-emerald-600">{retrievalScore}%</p>
        <p className="text-[10px] text-slate-400">检索自测</p>
      </div>
    </div>
  );
}

export function IntentDist({ counts }: { counts: Record<string, number> }) {
  const colors: Record<string, string> = {
    knowledge: "bg-blue-500",
    data: "bg-purple-500",
    policy: "bg-yellow-500",
    copywriting: "bg-pink-500",
    general: "bg-slate-400",
  };
  const labels: Record<string, string> = {
    knowledge: "知识",
    data: "数据",
    policy: "规则",
    copywriting: "文案",
    general: "通用",
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="space-y-1.5">
      {Object.entries(counts).map(([key, count]) => (
        <div key={key} className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${colors[key] ?? "bg-slate-300"}`} />
          <span className="w-10 text-xs text-slate-500">{labels[key] ?? key}</span>
          <div className="flex-1">
            <div className="h-1.5 rounded-full bg-slate-100">
              <div
                className={`h-1.5 rounded-full ${colors[key] ?? "bg-slate-300"}`}
                style={{ width: `${(count / total) * 100}%` }}
              />
            </div>
          </div>
          <span className="w-8 text-right text-xs text-slate-500">{count}</span>
        </div>
      ))}
    </div>
  );
}
