"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import DateRangePicker, { type DateRange } from "@/components/DateRangePicker";
import { CALL_TYPE_NAMES, MEETING_TYPE_NAMES } from "@/lib/crm/timelineShared";

export type ActivityRow = {
  id: string;
  // logged = past Activity; scheduled/done = future/completed Reminder.
  kind: "logged" | "scheduled" | "done";
  typeName: string | null;
  title: string;
  detail: string | null;
  timestamp: string;
  durationMins: number | null;
  outcome: string | null;
  ownerName: string;
  dealId: string | null;
  dealCode: string | null;
  accountId: string | null;
  accountName: string | null;
  contactName: string | null;
  contactPhone: string | null;
};

type TypeFilter = "all" | "calls" | "meetings";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// Per-type glyph: phone for calls, calendar for meetings, dot otherwise.
function TypeIcon({ typeName }: { typeName: string | null }) {
  const cls = "w-4 h-4 shrink-0";
  if (typeName && CALL_TYPE_NAMES.has(typeName)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${cls} text-wa-dark`} aria-label="Call">
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
    <svg viewBox="0 0 24 24" fill="currentColor" className={`${cls} text-slate-300`} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

const KIND_TAG: Record<ActivityRow["kind"], { label: string; cls: string }> = {
  logged: { label: "Logged", cls: "bg-slate-100 text-slate-500" },
  scheduled: { label: "Scheduled", cls: "bg-amber-100 text-amber-700" },
  done: { label: "Done", cls: "bg-wa-green/10 text-wa-dark" },
};

export default function ActivitiesClient({ isAdmin, activities, dateRange }: { isAdmin: boolean; activities: ActivityRow[]; dateRange: DateRange | null }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  function applyDateRange(range: DateRange) {
    router.push(`/crm/activities?from=${range.from}&to=${range.to}`);
  }

  const visible = activities.filter((a) => {
    if (typeFilter === "calls" && !(a.typeName && CALL_TYPE_NAMES.has(a.typeName))) return false;
    if (typeFilter === "meetings" && !(a.typeName && MEETING_TYPE_NAMES.has(a.typeName))) return false;
    const term = q.trim().toLowerCase();
    if (!term) return true;
    return (
      a.title.toLowerCase().includes(term) ||
      a.contactName?.toLowerCase().includes(term) ||
      a.contactPhone?.toLowerCase().includes(term) ||
      a.accountName?.toLowerCase().includes(term) ||
      a.dealCode?.toLowerCase().includes(term)
    );
  });

  const filterBtn = (value: TypeFilter, label: string) => (
    <button
      onClick={() => setTypeFilter(value)}
      className={`text-xs px-2.5 py-1 rounded-lg border ${typeFilter === value ? "bg-wa-green text-white border-wa-green" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <PageHeader
        large
        title="Activities"
        description={`${activities.length} ${isAdmin ? "team-wide" : "of yours"} — logged touchpoints and scheduled meetings/calls, most recent first`}
      />

      <div className="mb-3 flex items-center gap-3 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by subject, customer, phone, or deal code..."
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-sm"
        />
        <div className="flex items-center gap-1.5">
          {filterBtn("all", "All")}
          {filterBtn("calls", "Calls")}
          {filterBtn("meetings", "Meetings")}
        </div>
        <DateRangePicker value={dateRange ?? { from: "", to: "" }} onApply={applyDateRange} />
        {dateRange && (
          <button onClick={() => router.push("/crm/activities")} className="text-xs text-slate-500 hover:underline">
            Clear date filter
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400">
          No activities found.
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((a) => {
            const tag = KIND_TAG[a.kind];
            return (
              <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-3.5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    <TypeIcon typeName={a.typeName} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-medium text-slate-900 flex items-center gap-1.5 flex-wrap">
                      {a.typeName && <span className="text-xs font-semibold text-wa-dark bg-wa-green/10 px-1.5 py-0.5 rounded">{a.typeName}</span>}
                      <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${tag.cls}`}>{tag.label}</span>
                      <span>{a.title}</span>
                    </div>
                    {a.detail && <div className="text-sm text-slate-600 mt-1">{a.detail}</div>}
                    {(a.contactName || a.contactPhone) && (
                      <div className="text-sm text-slate-700 mt-1">
                        {a.contactName}
                        {a.contactPhone && <span className="text-slate-500">{a.contactName ? " · " : ""}{a.contactPhone}</span>}
                      </div>
                    )}
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                      <span>{fmtDate(a.timestamp)}</span>
                      <span>· {a.ownerName}</span>
                      {a.durationMins != null && <span>· {a.durationMins}m</span>}
                      {a.outcome && <span>· {a.outcome}</span>}
                      {a.dealId && (
                        <Link href={`/deals/${a.dealId}`} className="text-wa-dark hover:underline">
                          · {a.dealCode}
                        </Link>
                      )}
                      {!a.dealId && a.accountId && (
                        <Link href={`/crm/companies/${a.accountId}`} className="text-wa-dark hover:underline">
                          · {a.accountName}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
