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
  contactId: string | null;
};

type TypeFilter = "all" | "calls" | "meetings" | "other";

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
  const [todayOnly, setTodayOnly] = useState(false);

  function applyDateRange(range: DateRange) {
    router.push(`/crm/activities?from=${range.from}&to=${range.to}`);
  }

  const isCall = (t: string | null) => !!t && CALL_TYPE_NAMES.has(t);
  const isMeeting = (t: string | null) => !!t && MEETING_TYPE_NAMES.has(t);
  // "Today" is a client-side quick filter over the loaded rows; the date-range
  // picker (server-side) still works alongside it.
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);

  const visible = activities.filter((a) => {
    if (typeFilter === "calls" && !isCall(a.typeName)) return false;
    if (typeFilter === "meetings" && !isMeeting(a.typeName)) return false;
    if (typeFilter === "other" && (isCall(a.typeName) || isMeeting(a.typeName))) return false;
    if (todayOnly) {
      const t = new Date(a.timestamp);
      if (t < dayStart || t > dayEnd) return false;
    }
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

  const counts = {
    all: activities.length,
    calls: activities.filter((a) => isCall(a.typeName)).length,
    meetings: activities.filter((a) => isMeeting(a.typeName)).length,
    other: activities.filter((a) => !isCall(a.typeName) && !isMeeting(a.typeName)).length,
  };

  const typeItem = (value: TypeFilter, label: string, count: number) => (
    <button
      onClick={() => setTypeFilter(value)}
      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm ${typeFilter === value ? "bg-wa-green/10 text-wa-dark font-medium" : "text-slate-600 hover:bg-slate-100"}`}
    >
      <span>{label}</span>
      <span className="text-xs text-slate-400">{count}</span>
    </button>
  );

  const whenItem = (value: boolean, label: string) => (
    <button
      onClick={() => setTodayOnly(value)}
      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm ${todayOnly === value ? "bg-wa-green/10 text-wa-dark font-medium" : "text-slate-600 hover:bg-slate-100"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        large
        title="Activities"
        description={`${activities.length} ${isAdmin ? "team-wide" : "of yours"} — logged touchpoints and scheduled meetings/calls, most recent first`}
      />

      <div className="flex flex-col lg:flex-row gap-6 mt-4">
        {/* Left filter sidebar — type (call/meeting/other) + when (today). */}
        <aside className="lg:w-48 shrink-0 lg:sticky lg:top-4 self-start">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide px-2.5 mb-1">Type</div>
          <div className="space-y-0.5 mb-4">
            {typeItem("all", "All", counts.all)}
            {typeItem("calls", "Calls", counts.calls)}
            {typeItem("meetings", "Meetings", counts.meetings)}
            {typeItem("other", "Other", counts.other)}
          </div>
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide px-2.5 mb-1">When</div>
          <div className="space-y-0.5">
            {whenItem(false, "All time")}
            {whenItem(true, "Today")}
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          <div className="mb-3 flex items-center gap-3 flex-wrap">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by subject, customer, phone, or deal code..."
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-sm"
            />
            <DateRangePicker value={dateRange ?? { from: "", to: "" }} onApply={applyDateRange} />
            {dateRange && (
              <button onClick={() => router.push("/crm/activities")} className="text-xs text-slate-500 hover:underline">
                Clear date filter
              </button>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600 border-b border-slate-200">
              <th className="px-4 py-2.5 font-semibold">Type</th>
              <th className="px-4 py-2.5 font-semibold">Activity</th>
              <th className="px-4 py-2.5 font-semibold">Customer</th>
              <th className="px-4 py-2.5 font-semibold">Phone</th>
              <th className="px-4 py-2.5 font-semibold whitespace-nowrap">When</th>
              <th className="px-4 py-2.5 font-semibold">Owner</th>
              <th className="px-4 py-2.5 font-semibold">Deal</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => {
              const tag = KIND_TAG[a.kind];
              return (
                <tr key={a.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 align-top">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <TypeIcon typeName={a.typeName} />
                      <span className="text-slate-700 whitespace-nowrap">{a.typeName ?? "—"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-900">{a.title}</div>
                    {a.detail && <div className="text-xs text-slate-500 mt-0.5 max-w-xs truncate" title={a.detail}>{a.detail}</div>}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {a.contactName ? (
                      a.contactId ? (
                        <Link href={`/crm/contacts/${a.contactId}`} className="text-wa-dark hover:underline font-medium">{a.contactName}</Link>
                      ) : (
                        <span className="text-slate-700">{a.contactName}</span>
                      )
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{a.contactPhone ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{fmtDate(a.timestamp)}</td>
                  <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{a.ownerName}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {a.dealId ? (
                      <Link href={`/deals/${a.dealId}`} className="text-wa-dark hover:underline">{a.dealCode}</Link>
                    ) : a.accountId ? (
                      <Link href={`/crm/companies/${a.accountId}`} className="text-wa-dark hover:underline">{a.accountName}</Link>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${tag.cls}`}>{tag.label}</span>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No activities found.</td>
              </tr>
            )}
          </tbody>
        </table>
          </div>
        </div>
      </div>
    </div>
  );
}
