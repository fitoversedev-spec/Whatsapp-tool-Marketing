"use client";

// The actual numbers behind every chart on an analytics page, always shown
// below it (not just on hover) — same headers/rows each section already
// builds for its own ExportButtons, so chart and table can never drift apart.
export function DataTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-600 border-b border-slate-200">
            {headers.map((h) => <th key={h} className="px-2 py-2 font-semibold whitespace-nowrap">{h}</th>)}
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
  );
}
