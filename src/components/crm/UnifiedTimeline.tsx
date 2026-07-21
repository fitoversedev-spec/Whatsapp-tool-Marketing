import { CALL_TYPE_NAMES, MEETING_TYPE_NAMES, type TimelineEntry } from "@/lib/crm/timelineShared";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// A call/meeting can show up as either kind (a scheduled Reminder or a
// logged Activity) — the badge should read CALL/MEETING either way, with
// only the color distinguishing scheduled-vs-logged-vs-done, same as the
// dedicated Meetings/Calls sections on Contact Detail.
function styleFor(e: TimelineEntry): { border: string; badge: string; label: string } {
  const typeLabel = e.typeName && CALL_TYPE_NAMES.has(e.typeName) ? "CALL" : e.typeName && MEETING_TYPE_NAMES.has(e.typeName) ? "MEETING" : null;

  if (e.kind === "reminder") {
    return e.completed
      ? { border: "border-slate-200", badge: "bg-slate-100 text-slate-600", label: typeLabel ?? "DONE" }
      : { border: "border-amber-300", badge: "bg-amber-100 text-amber-700", label: typeLabel ?? "REMINDER" };
  }
  if (e.kind === "created") return { border: "border-slate-300", badge: "bg-slate-100 text-slate-600", label: "CREATED" };
  if (e.kind === "stage") return { border: "border-blue-300", badge: "bg-blue-100 text-blue-700", label: "STAGE" };
  return { border: "border-wa-green/40", badge: "bg-wa-green/10 text-wa-dark", label: typeLabel ?? "ACTIVITY" };
}

export default function UnifiedTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-400">Nothing here yet — logged activities, reminders, and stage changes will show up together, most recent first.</p>;
  }

  return (
    <div className="space-y-3">
      {entries.map((e) => {
        const style = styleFor(e);
        return (
          <div key={`${e.kind}-${e.id}`} className={`text-sm border-l-2 pl-3 ${style.border}`}>
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${style.badge}`}>{style.label}</span>
              <span className={`text-base font-medium ${e.kind === "reminder" && e.completed ? "text-slate-400 line-through" : "text-slate-800"}`}>
                {e.title}
              </span>
            </div>
            {e.detail && <div className="text-slate-600 text-sm mt-0.5">{e.detail}</div>}
            <div className="text-xs text-slate-500 mt-0.5">
              {fmtDate(e.timestamp)} · {e.ownerName}
            </div>
          </div>
        );
      })}
    </div>
  );
}
