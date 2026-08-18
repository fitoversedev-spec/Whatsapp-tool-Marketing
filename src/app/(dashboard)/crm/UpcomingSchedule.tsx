// Dashboard "Upcoming schedule" card — scheduled meetings / calls / tasks
// (Reminder rows with an ActivityType) that are overdue or fall within the
// next 7 days, grouped Overdue / Today / Tomorrow / This week. Server
// component (no interactivity): rendered for reps scoped to their own
// reminders and for admins team-wide (showOwner). Data comes from
// getUpcomingSchedule() in @/lib/crm/myDay. In-app only — this always-visible
// list plus the existing due-today badge are the notification.
import { CALL_TYPE_NAMES, MEETING_TYPE_NAMES } from "@/lib/crm/timelineShared";
import type { UpcomingReminder, UpcomingScheduleData } from "@/lib/crm/myDay";

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-100 text-slate-600",
};

// Format the due instant in IST (server runs in UTC on Vercel).
function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Per-type glyph — mirrors the Activities feed: phone for calls, calendar for
// meetings, dot for anything else (e.g. Task).
function TypeIcon({ typeName }: { typeName: string | null }) {
  const cls = "w-4 h-4 shrink-0 mt-0.5";
  if (typeName && CALL_TYPE_NAMES.has(typeName)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${cls} text-court-600`} aria-label="Call">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    );
  }
  if (typeName && MEETING_TYPE_NAMES.has(typeName)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${cls} text-blue-500`} aria-label="Meeting">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={`${cls} text-slate-300`} aria-label="Task">
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function ScheduleRow({ r, showOwner, overdue }: { r: UpcomingReminder; showOwner: boolean; overdue: boolean }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <TypeIcon typeName={r.typeName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {r.priority && (
            <span className={`badge ${PRIORITY_COLORS[r.priority] ?? "bg-slate-100 text-slate-600"}`}>{r.priority}</span>
          )}
          <span className="text-slate-800">{r.message}</span>
        </div>
        <div className={`text-xs font-mono mt-0.5 ${overdue ? "text-red-600" : "text-slate-400"}`}>
          {r.typeName ?? "Reminder"} · {fmtWhen(r.dueAt)}
          {showOwner && <span className="text-slate-500"> · {r.ownerName}</span>}
        </div>
      </div>
    </div>
  );
}

const GROUPS: { key: "overdue" | "today" | "tomorrow" | "week"; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "This week" },
];

export default function UpcomingSchedule({
  data,
  showOwner = false,
  className,
}: {
  data: UpcomingScheduleData;
  showOwner?: boolean;
  className?: string;
}) {
  return (
    <div className={`card p-4 ${className ?? ""}`}>
      <h3 className="text-base font-semibold text-slate-900 mb-3">
        Upcoming schedule <span className="text-slate-400 font-normal font-mono">{data.total}</span>
      </h3>
      {data.total === 0 ? (
        <p className="text-sm text-slate-400">No meetings, calls, or tasks scheduled in the next 7 days.</p>
      ) : (
        <div className="space-y-4">
          {GROUPS.map(({ key, label }) => {
            const rows = data[key];
            if (rows.length === 0) return null;
            const isOverdue = key === "overdue";
            return (
              <div key={key}>
                <div className={`text-[11px] font-semibold uppercase tracking-wide mb-1.5 ${isOverdue ? "text-red-600" : "text-slate-400"}`}>
                  {label} <span className="font-mono font-normal">{rows.length}</span>
                </div>
                <div className="space-y-2">
                  {rows.map((r) => (
                    <ScheduleRow key={r.id} r={r} showOwner={showOwner} overdue={isOverdue} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
