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
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Quotations sent", curr: thisMonth.quotationsSent, prev: lastMonth.quotationsSent, fmt: (n: number) => String(n) },
              { label: "Quoted value", curr: thisMonth.quotedValue, prev: lastMonth.quotedValue, fmt: fmtInr },
              { label: "Deals won", curr: thisMonth.dealsWon, prev: lastMonth.dealsWon, fmt: (n: number) => String(n) },
              { label: "Won value", curr: thisMonth.wonValue, prev: lastMonth.wonValue, fmt: fmtInr },
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

          <div className="card p-4">
            <h3 className="text-base font-semibold text-slate-900 mb-3">Biggest movers this month</h3>
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
      <PageHeader large title="My Day" description={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })} />
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="card p-4">
            <h3 className="text-base font-semibold text-slate-900 mb-3">Due today <span className="text-slate-400 font-normal font-mono">{myDay.dueToday.length}</span></h3>
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
            <h3 className="text-base font-semibold text-slate-900 mb-3">Overdue <span className="text-slate-400 font-normal font-mono">{myDay.overdue.length}</span></h3>
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

          <div className="card p-4">
            <h3 className="text-base font-semibold text-slate-900 mb-3">Untouched 7+ days <span className="text-slate-400 font-normal font-mono">{myDay.noRecentActivityDeals.length}</span></h3>
            {myDay.noRecentActivityDeals.length === 0 ? (
              <p className="text-sm text-slate-400">Every open deal has recent activity.</p>
            ) : (
              <div className="space-y-1.5">
                {myDay.noRecentActivityDeals.map((d) => (
                  <Link key={d.id} href={`/deals/${d.id}`} className="block text-sm text-court-700 hover:underline"><span className="font-mono">{d.code}</span> — {d.title}</Link>
                ))}
              </div>
            )}
          </div>

          <div className="card p-4">
            <h3 className="text-base font-semibold text-slate-900 mb-3">Closing this week <span className="text-slate-400 font-normal font-mono">{myDay.closingThisWeek.length}</span></h3>
            {myDay.closingThisWeek.length === 0 ? (
              <p className="text-sm text-slate-400">No expected close dates in the next 7 days.</p>
            ) : (
              <div className="space-y-1.5">
                {myDay.closingThisWeek.map((d) => (
                  <Link key={d.id} href={`/deals/${d.id}`} className="flex items-center justify-between text-sm text-court-700 hover:underline">
                    <span><span className="font-mono">{d.code}</span> — {d.title}</span>
                    <span className="text-xs text-slate-400 font-mono">{fmtDate(d.expectedCloseAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <UpcomingSchedule data={upcoming} />

        {myDay.stuckDeals.length > 0 && (
          <div className="rounded-md border border-red-200 bg-white p-4">
            <h3 className="text-base font-semibold text-slate-900 mb-2">Stuck in stage <span className="text-slate-400 font-normal font-mono">{myDay.stuckDeals.length}</span></h3>
            <div className="flex flex-wrap gap-2">
              {myDay.stuckDeals.map((d) => (
                <Link key={d.id} href={`/deals/${d.id}`} className="badge bg-red-100 text-red-700 hover:bg-red-200 font-mono">
                  {d.code}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
