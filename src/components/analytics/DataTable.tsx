"use client";

// The actual numbers behind every chart on an analytics page, always shown
// below it (not just on hover) — same headers/rows each section already
// builds for its own ExportButtons, so chart and table can never drift apart.
export function DataTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <>
      {/* Mobile: stacked cards */}
      <div className="md:hidden divide-y divide-slate-100">
        {rows.map((row, i) => (
          <div key={i} className="px-2 py-3">
            <div className="font-medium text-slate-900 text-sm mb-1.5">{row[0]}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {headers.slice(1).map((h, j) => (
                <div key={h} className="flex justify-between text-xs">
                  <span className="text-slate-500">{h}</span>
                  <span className="font-medium text-slate-700">{row[j + 1]}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* Desktop: table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-slate-200">
              {headers.map((h) => <th key={h} className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-100 last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className={`px-2 py-2 whitespace-nowrap ${j === 0 ? "font-medium text-slate-900" : "text-slate-700"}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
