"use client";

const TYPE_STYLES: Record<string, string> = {
  warning: "border-l-amber-400 bg-amber-50",
  info: "border-l-blue-400 bg-blue-50",
  suggestion: "border-l-emerald-400 bg-emerald-50",
};

export function InsightCard({
  icon,
  text,
  type,
}: {
  icon: string;
  text: string;
  type: string;
}) {
  const s = TYPE_STYLES[type] ?? "border-l-slate-300 bg-slate-50";
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border border-slate-100 border-l-4 px-3 py-2.5 ${s}`}
    >
      <span className="text-base leading-6" aria-hidden="true">
        {icon}
      </span>
      <p className="text-sm leading-6 text-slate-700">{text}</p>
    </div>
  );
}
