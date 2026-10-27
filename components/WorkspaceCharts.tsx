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

export function TrendChart({ data, height = 120 }: { data: Array<{ date: string; gmv: number; orders: number }>; height?: number }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-400" style={{ height }}>
        暂无趋势数据
      </div>
    );
  }

  const W = 320;
  const PAD_X = 6;
  const PAD_TOP = 8;
  const PAD_BOTTOM = 4;
  const chartH = height - PAD_TOP - PAD_BOTTOM;
  const maxGmv = Math.max(...data.map((d) => d.gmv), 1);
  const maxOrders = Math.max(...data.map((d) => d.orders), 1);
  const px = (i: number) => (data.length === 1 ? W / 2 : PAD_X + (i * (W - 2 * PAD_X)) / (data.length - 1));
  const py = (v: number, max: number) => PAD_TOP + chartH * (1 - v / max);
  const path = (pick: (d: { gmv: number; orders: number }) => number, max: number) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(pick(d), max).toFixed(1)}`).join(" ");

  const midIdx = Math.floor((data.length - 1) / 2);
  const ticks = data.length <= 2 ? data.map((_, i) => i) : [0, midIdx, data.length - 1];

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-end gap-3">
        <span className="flex items-center gap-1 text-[10px] text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> GMV
        </span>
        <span className="flex items-center gap-1 text-[10px] text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> 订单
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${chartH}`}
        width="100%"
        height={chartH}
        preserveAspectRatio="none"
        className="block"
        role="img"
        aria-label="30 天 GMV 与订单数趋势"
      >
        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={PAD_TOP + chartH * t}
            y2={PAD_TOP + chartH * t}
            stroke="#e2e8f0"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path
          d={path((d) => d.gmv, maxGmv)}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={path((d) => d.orders, maxOrders)}
          fill="none"
          stroke="#10b981"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        {ticks.map((i, pos) => (
          <span key={i} className={pos === 0 ? "" : pos === ticks.length - 1 ? "text-right" : ""}>
            {data[i].date.slice(5)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DonutChart({ data, size = 160 }: { data: Array<{ label: string; value: number; color: string }>; size?: number }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  let cursor = 0;
  const stops = data.map((d) => {
    const from = total > 0 ? (cursor / total) * 100 : 0;
    cursor += d.value;
    const to = total > 0 ? (cursor / total) * 100 : 0;
    return `${d.color} ${from}% ${to}%`;
  });
  const ring = total > 0 ? `conic-gradient(${stops.join(", ")})` : "#e2e8f0";

  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <div className="relative rounded-full" style={{ width: size, height: size, background: ring }}>
          <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-white">
            <p className="text-lg font-bold text-slate-800">{total.toLocaleString()}</p>
            <p className="text-[10px] text-slate-400">总计</p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-x-2.5 gap-y-1">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="text-xs text-slate-500">{d.label}</span>
            <span className="text-xs text-slate-600">{d.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
