"use client";

// Rep Usage tab body (admin-only) for CRM Analytics. Two views:
//   - "team": a table of every rep — online-now, active time (today / week /
//     selected range), avg per active day, active days, sessions, and today's
//     first-in / last-active. Click a rep → a drill-down that lazily loads that
//     rep's own heatmap + raw session list.
//   - "heatmap": the team-wide active-hours heatmap.
// All timestamps are shown in IST. Data is captured by the visibility-gated 15s
// heartbeat (src/lib/usage/heartbeat.ts); this is active tool-time, not
// productivity.

import { useEffect, useState } from "react";
import type { DateRange } from "@/components/DateRangePicker";
import { fmtDuration } from "./charts";
import UsageHeatmap from "./UsageHeatmap";

type OverviewRow = {
  userId: string;
  userName: string;
  role: string;
  online: boolean;
  lastSeenAt: string | null;
  activeSecondsToday: number;
  activeSecondsWeek: number;
  activeSecondsRange: number;
  activeDays: number;
  avgSecondsPerActiveDay: number | null;
  sessionCount: number;
  firstInToday: string | null;
  lastActiveToday: string | null;
};
type HeatCell = { weekday: number; hour: number; activeSeconds: number };
type SessionRow = { id: string; startedAt: string; lastSeenAt: string; endedAt: string | null; activeSeconds: number };

const IST = "Asia/Kolkata";
function tIST(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: IST });
}
function dtIST(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: IST });
}

export default function UsageTab({
  view,
  overview,
  heatmap,
  range,
}: {
  view: "team" | "heatmap";
  overview: OverviewRow[];
  heatmap: HeatCell[];
  range: DateRange;
}) {
  const [selected, setSelected] = useState<OverviewRow | null>(null);
  const [drill, setDrill] = useState<{ sessions: SessionRow[]; userHeatmap: HeatCell[] } | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    if (!selected) return;
    setDrill(null);
    setDrillLoading(true);
    fetch(`/api/crm/analytics/usage?userId=${selected.userId}&from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((d) => setDrill({ sessions: d.sessions ?? [], userHeatmap: d.userHeatmap ?? [] }))
      .finally(() => setDrillLoading(false));
  }, [selected, range]);

  if (view === "heatmap") {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-800 mb-1">When the team is active</div>
        <div className="text-xs text-slate-400 mb-3">Total active tool-time by weekday and hour (IST), across the selected range.</div>
        <UsageHeatmap cells={heatmap} />
      </div>
    );
  }

  const rows = [...overview].sort((a, b) => b.activeSecondsRange - a.activeSecondsRange);
  const onlineCount = rows.filter((r) => r.online).length;

  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5 mr-3">
          <span className="w-2 h-2 rounded-full bg-wa-green inline-block" /> {onlineCount} online now
        </span>
        Active tool-time — measured from a 15s heartbeat while the app tab is open. This reflects presence in the tool, not productivity.
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs">
              <th className="text-left font-medium px-3 py-2">Rep</th>
              <th className="text-left font-medium px-3 py-2">Status</th>
              <th className="text-right font-medium px-3 py-2">Today</th>
              <th className="text-right font-medium px-3 py-2">This week</th>
              <th className="text-right font-medium px-3 py-2">In range</th>
              <th className="text-right font-medium px-3 py-2">Avg / day</th>
              <th className="text-right font-medium px-3 py-2">Active days</th>
              <th className="text-right font-medium px-3 py-2">Sessions</th>
              <th className="text-left font-medium px-3 py-2">First in</th>
              <th className="text-left font-medium px-3 py-2">Last active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.userId}
                onClick={() => setSelected(r)}
                className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
              >
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800">{r.userName}</div>
                  <div className="text-[11px] text-slate-400 uppercase">{r.role}</div>
                </td>
                <td className="px-3 py-2">
                  {r.online ? (
                    <span className="inline-flex items-center gap-1.5 text-wa-dark text-xs font-medium">
                      <span className="w-2 h-2 rounded-full bg-wa-green inline-block" /> Online
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">{r.lastSeenAt ? `Seen ${tIST(r.lastSeenAt)}` : "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtDuration(r.activeSecondsToday)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtDuration(r.activeSecondsWeek)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtDuration(r.activeSecondsRange)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtDuration(r.avgSecondsPerActiveDay)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.activeDays}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.sessionCount}</td>
                <td className="px-3 py-2 text-slate-600">{tIST(r.firstInToday)}</td>
                <td className="px-3 py-2 text-slate-600">{tIST(r.lastActiveToday)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-slate-400 text-sm">No usage recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-slate-800">{selected.userName} — usage detail</div>
            <button onClick={() => setSelected(null)} className="text-xs text-slate-400 hover:text-slate-700">close ✕</button>
          </div>
          {drillLoading || !drill ? (
            <div className="text-sm text-slate-400 py-6 text-center">Loading…</div>
          ) : (
            <div className="space-y-5">
              <div>
                <div className="text-xs font-medium text-slate-500 mb-2">Active-hours heatmap (IST)</div>
                <UsageHeatmap cells={drill.userHeatmap} />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 mb-2">Sessions</div>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs">
                        <th className="text-left font-medium px-3 py-2">Started</th>
                        <th className="text-left font-medium px-3 py-2">Ended</th>
                        <th className="text-right font-medium px-3 py-2">Active time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drill.sessions.map((s) => (
                        <tr key={s.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-700">{dtIST(s.startedAt)}</td>
                          <td className="px-3 py-2 text-slate-700">{s.endedAt ? dtIST(s.endedAt) : <span className="text-wa-dark">ongoing</span>}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtDuration(s.activeSeconds)}</td>
                        </tr>
                      ))}
                      {drill.sessions.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-3 py-6 text-center text-slate-400 text-sm">No sessions in this range.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
