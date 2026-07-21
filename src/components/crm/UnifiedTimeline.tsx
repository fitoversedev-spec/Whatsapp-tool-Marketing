import type { TimelineEntry } from "@/lib/crm/timeline";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function UnifiedTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-400">Nothing here yet — logged activities and reminders will show up together, most recent first.</p>;
  }

  return (
    <div className="space-y-3">
      {entries.map((e) => (
        <div
          key={`${e.kind}-${e.id}`}
          className={`text-sm border-l-2 pl-3 ${
            e.kind === "reminder" ? (e.completed ? "border-slate-200" : "border-amber-300") : e.kind === "created" ? "border-slate-300" : "border-wa-green/40"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                e.kind === "reminder" ? "bg-amber-100 text-amber-700" : e.kind === "created" ? "bg-slate-100 text-slate-600" : "bg-wa-green/10 text-wa-dark"
              }`}
            >
              {e.kind === "reminder" ? (e.completed ? "DONE" : "REMINDER") : e.kind === "created" ? "CREATED" : "ACTIVITY"}
            </span>
            <span className={`text-base font-medium ${e.kind === "reminder" && e.completed ? "text-slate-400 line-through" : "text-slate-800"}`}>
              {e.title}
            </span>
          </div>
          {e.detail && <div className="text-slate-600 text-sm mt-0.5">{e.detail}</div>}
          <div className="text-xs text-slate-500 mt-0.5">
            {fmtDate(e.timestamp)} · {e.ownerName}
          </div>
        </div>
      ))}
    </div>
  );
}
