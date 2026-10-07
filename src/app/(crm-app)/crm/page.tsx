import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { getMyDay, getUpcomingSchedule } from "@/lib/crm/myDay";
import { overview } from "@/lib/analytics/overview";
import PageHeader from "@/components/PageHeader";
import UpcomingSchedule from "./UpcomingSchedule";

function fmtInr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

export default async function CrmDashboardPage() {
  const user = await requireUser();

  if (isAdmin(user.role)) {
    const [{ thisMonth, lastMonth, topMovers }, upcoming] = await Promise.all([overview(), getUpcomingSchedule()]);
    const delta = (curr: number, prev: number) => (prev === 0 ? null : Math.round(((curr - prev) / prev) * 100));

    return (
      <>
        <PageHeader large title="Team overview" description="This month vs last month across the whole team" />
        <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-guide="crm-dashboard-kpis">
            {[
              { label: "Quotations sent", curr: thisMonth.quotationsSent, prev: lastMonth.quotationsSent, fmt: (n: number) => String(n) },
              { label: "Quoted value", curr: thisMonth.quotedValue, prev: lastMonth.quotedValue, fmt: fmtInr },
              { label: "New deals", curr: thisMonth.dealsWon, prev: lastMonth.dealsWon, fmt: (n: number) => String(n) },
              { label: "Deal value", curr: thisMonth.wonValue, prev: lastMonth.wonValue, fmt: fmtInr },
            ].map((m) => {
              const d = delta(m.curr, m.prev);
              return (
                <div key={m.label} className="card p-4">
                  <div className="text-sm text-slate-600">{m.label}</div>
                  <div className="text-xl font-semibold text-slate-900 mt-1 font-mono">{m.fmt(m.curr)}</div>
                  {d !== null && (
                    <div className={`text-xs font-medium mt-1 font-mono ${d >= 0 ? "text-green-700" : "text-red-600"}`}>
                      {d >= 0 ? "▲" : "▼"} {Math.abs(d)}% vs last month
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="card p-4" data-guide="crm-dashboard-movers">
            <h3 className="text-lg font-bold text-slate-900 mb-3">Biggest movers this month</h3>
            {topMovers.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing to compare yet.</p>
            ) : (
              <div className="space-y-2">
                {topMovers.map((m) => (
                  <div key={m.ownerName} className="flex items-center justify-between text-sm">
                    <span className="text-slate-800">{m.ownerName}</span>
                    <span className={`font-medium font-mono ${m.wonValueDelta >= 0 ? "text-green-700" : "text-red-600"}`}>
                      {m.wonValueDelta >= 0 ? "+" : ""}{fmtInr(m.wonValueDelta)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <UpcomingSchedule data={upcoming} showOwner />

          <div className="flex gap-3 text-sm">
            <Link href="/crm/analytics" className="text-court-700 hover:underline font-medium">Full CRM Analytics →</Link>
          </div>
        </div>
      </>
    );
  }

  const [myDay, upcoming] = await Promise.all([getMyDay(user.id), getUpcomingSchedule({ ownerUserId: user.id })]);

  return (
    <>
      <PageHeader large title="My Day" description={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })} />
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="card p-4">
            <h3 className="text-lg font-bold text-slate-900 mb-3">Due today <span className="text-slate-400 font-normal font-mono">{myDay.dueToday.length}</span></h3>
            {myDay.dueToday.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing due today.</p>
            ) : (
              <div className="space-y-2">
                {myDay.dueToday.map((r) => (
                  <div key={r.id} className="text-sm"><span className="text-slate-800">{r.message}</span><div className="text-xs text-slate-400 font-mono">{fmtDateTime(r.dueAt)}</div></div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50/40 p-4">
            <h3 className="text-lg font-bold text-slate-900 mb-3">Overdue <span className="text-slate-400 font-normal font-mono">{myDay.overdue.length}</span></h3>
            {myDay.overdue.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing overdue — you're caught up.</p>
            ) : (
              <div className="space-y-2">
                {myDay.overdue.map((r) => (
                  <div key={r.id} className="text-sm"><span className="text-slate-800">{r.message}</span><div className="text-xs text-red-600 font-mono">{fmtDateTime(r.dueAt)}</div></div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-4" data-guide="crm-myday-untouched">
            <h3 className="text-lg font-bold text-slate-900 mb-3">Leads untouched 7+ days <span className="text-slate-400 font-normal font-mono">{myDay.untouchedLeads.length}</span></h3>
            {myDay.untouchedLeads.length === 0 ? (
              <p className="text-sm text-slate-400">Every lead has recent activity.</p>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {myDay.untouchedLeads.map((l) => (
                  <Link key={l.id} href={`/crm/contacts/${l.id}`} className="flex items-center justify-between gap-2 text-sm text-court-700 hover:underline">
                    <span className="truncate">{l.name}{l.company ? <span className="text-slate-500"> · {l.company}</span> : null}</span>
                    <span className="text-xs text-slate-400 font-mono shrink-0">{fmtDate(l.lastTouchAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="card p-4" data-guide="crm-myday-next-actions">
            <h3 className="text-lg font-bold text-slate-900 mb-3">Next actions this week <span className="text-slate-400 font-normal font-mono">{myDay.nextActionsThisWeekTotal}</span></h3>
            {myDay.nextActionsThisWeek.length === 0 ? (
              <p className="text-sm text-slate-400">No next actions due in the next 7 days.</p>
            ) : (
              <div className="space-y-2">
                {myDay.nextActionsThisWeek.map((a) => (
                  <Link key={a.id} href={`/crm/contacts/${a.contactId}`} className="block text-sm hover:underline">
                    <span className="text-slate-800">{a.text}</span>
                    <div className="text-xs text-slate-500"><span className="text-court-700">{a.contactName}</span> · <span className="font-mono">{fmtDateTime(a.dueAt)}</span></div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <UpcomingSchedule data={upcoming} />
      </div>
    </>
  );
}
