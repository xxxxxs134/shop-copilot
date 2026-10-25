"use client";

export function OrderTimeline({ events }: { events: Array<{ date: string; label: string; status: string }> }) {
  return (
    <div className="flex flex-col gap-0">
      {events.map((e, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex flex-col items-center">
            <div
              className={`h-2.5 w-2.5 rounded-full ${
                e.status === "done"
                  ? "bg-emerald-500"
                  : e.status === "current"
                    ? "bg-brand-600"
                    : "bg-slate-200"
              }`}
            />
            {i < events.length - 1 && (
              <div
                className={`w-px flex-1 ${
                  e.status === "done" ? "bg-emerald-300" : "bg-slate-200"
                }`}
              />
            )}
          </div>
          <div className="flex-1 pb-3">
            <p
              className={`text-xs ${
                e.status === "done"
                  ? "text-slate-600"
                  : e.status === "current"
                    ? "font-medium text-slate-800"
                    : "text-slate-400"
              }`}
            >
              {e.label}
            </p>
            <p className="text-[10px] text-slate-400">{e.date}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
