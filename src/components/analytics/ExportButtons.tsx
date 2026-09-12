"use client";

import { downloadCsv, downloadXlsx } from "@/lib/analytics/export";

export function ExportButtons({ filename, headers, rows }: { filename: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="flex gap-2 text-xs">
      <button onClick={() => downloadCsv(filename, headers, rows)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-colors">Export CSV</button>
      <button onClick={() => downloadXlsx(filename, headers, rows)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-colors">Export XLSX</button>
    </div>
  );
}
