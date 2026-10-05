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

  switch (e.kind) {
    case "reminder":
      return e.completed
        ? { border: "border-slate-200", badge: "bg-slate-100 text-slate-600", label: typeLabel ?? "DONE" }
        : { border: "border-amber-300", badge: "bg-amber-100 text-amber-700", label: typeLabel ?? "REMINDER" };
    case "created":
      return { border: "border-slate-300", badge: "bg-slate-100 text-slate-600", label: "CREATED" };
    case "stage":
      return { border: "border-court-300", badge: "bg-court-100 text-court-700", label: "DEAL STAGE" };
    case "deal":
      return { border: "border-emerald-300", badge: "bg-emerald-100 text-emerald-700", label: "DEAL" };
    case "note":
      return { border: "border-slate-300", badge: "bg-slate-100 text-slate-700", label: "NOTE" };
    case "file":
      return { border: "border-sky-300", badge: "bg-sky-100 text-sky-700", label: "FILE" };
    case "quote":
      return { border: "border-blue-300", badge: "bg-blue-100 text-blue-800", label: "QUOTATION" };
    case "design":
      return { border: "border-purple-300", badge: "bg-purple-100 text-purple-800", label: "DESIGN" };
    case "product":
      return { border: "border-slate-300", badge: "bg-slate-100 text-slate-700", label: "PRODUCT" };
    case "next_action":
      return { border: "border-amber-300", badge: "bg-amber-100 text-amber-800", label: "NEXT ACTION" };
    case "insight":
      return { border: "border-purple-300", badge: "bg-purple-100 text-purple-800", label: "INSIGHT" };
    case "change": {
      const label = e.label ?? "UPDATE";
      if (label === "DELETED") return { border: "border-red-300", badge: "bg-red-100 text-red-700", label };
      if (label === "STAGE" || label === "LEADS") return { border: "border-indigo-300", badge: "bg-indigo-100 text-indigo-700", label };
      return { border: "border-slate-300", badge: "bg-slate-100 text-slate-700", label };
    }
    default:
      return { border: "border-turf-300", badge: "bg-turf-100 text-turf-700", label: typeLabel ?? "ACTIVITY" };
  }
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
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`badge ${style.badge}`}>{style.label}</span>
              <span className={`text-base font-medium ${e.kind === "reminder" && e.completed ? "text-slate-400" : "text-slate-800"}`}>
                {e.title}
              </span>
            </div>
            {e.detail && <div className="text-slate-600 text-sm mt-0.5 whitespace-pre-line">{e.detail}</div>}
            <div className="text-xs text-slate-500 mt-0.5">
              <span className="font-mono">{fmtDate(e.timestamp)}</span>
              {e.ownerName ? ` · ${e.ownerName}` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
