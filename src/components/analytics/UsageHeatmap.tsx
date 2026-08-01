"use client";

// Active-hours heatmap for the Rep Usage tab: weekday (rows, Mon–Sun) × hour of
// day (cols, 0–23), cell intensity = active seconds, all in IST. Cells are
// green-tinted by their share of the busiest cell; hovering a cell shows the
// exact time. Pure presentational — the parent supplies the aggregated cells.

import { fmtDuration } from "./charts";

type HeatCell = { weekday: number; hour: number; activeSeconds: number };

// Postgres EXTRACT(DOW) is 0=Sun..6=Sat; we render Mon-first for a work week.
const ROW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const ROW_LABELS: Record<number, string> = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };

export default function UsageHeatmap({ cells }: { cells: HeatCell[] }) {
  const byKey = new Map<string, number>();
  let max = 0;
  for (const c of cells) {
    byKey.set(`${c.weekday}:${c.hour}`, c.activeSeconds);
    if (c.activeSeconds > max) max = c.activeSeconds;
  }

  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="w-10" />
            {hours.map((h) => (
              <th key={h} className="text-[9px] font-medium text-slate-400 text-center" style={{ minWidth: 18 }}>
                {h % 3 === 0 ? h : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROW_ORDER.map((wd) => (
            <tr key={wd}>
              <td className="text-[10px] font-medium text-slate-500 pr-1 text-right">{ROW_LABELS[wd]}</td>
              {hours.map((h) => {
                const secs = byKey.get(`${wd}:${h}`) ?? 0;
                const intensity = max > 0 ? secs / max : 0;
                // Fitoverse green (#159341) at a share-scaled alpha; a hair of
                // base tint so empty cells still read as a grid.
                const bg = secs > 0 ? `rgba(21,147,65,${(0.12 + intensity * 0.88).toFixed(3)})` : "rgba(148,163,184,0.10)";
                return (
                  <td
                    key={h}
                    title={`${ROW_LABELS[wd]} ${String(h).padStart(2, "0")}:00 — ${fmtDuration(secs)}`}
                    style={{ background: bg, width: 18, height: 18, borderRadius: 3 }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-400">
        <span>Less</span>
        <span className="inline-block rounded" style={{ width: 14, height: 14, background: "rgba(148,163,184,0.10)" }} />
        <span className="inline-block rounded" style={{ width: 14, height: 14, background: "rgba(21,147,65,0.35)" }} />
        <span className="inline-block rounded" style={{ width: 14, height: 14, background: "rgba(21,147,65,0.65)" }} />
        <span className="inline-block rounded" style={{ width: 14, height: 14, background: "rgba(21,147,65,1)" }} />
        <span>More</span>
        <span className="ml-2">· hours shown in IST</span>
      </div>
    </div>
  );
}
