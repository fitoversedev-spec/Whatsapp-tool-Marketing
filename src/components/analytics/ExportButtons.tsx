"use client";

import { downloadCsv, downloadXlsx } from "@/lib/analytics/export";

export function ExportButtons({ filename, headers, rows }: { filename: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="flex gap-3 text-xs">
      <button onClick={() => downloadCsv(filename, headers, rows)} className="text-wa-dark hover:underline font-medium">Export CSV</button>
      <button onClick={() => downloadXlsx(filename, headers, rows)} className="text-wa-dark hover:underline font-medium">Export XLSX</button>
    </div>
  );
}
