"use client";

// Month/Quarter/FY selector shared by the Targets admin form and the
// Overview tab's period control — both need to land on the exact same
// calendar boundary as a stored Target row (see periodPresets.ts). A plain
// from/to DateRangePicker can't guarantee that alignment, so this is a
// deliberately separate, boundary-snapped control rather than a reuse of
// DateRangePicker.
import { useState, useEffect } from "react";
import type { Period, PeriodType } from "@/lib/analytics/periodPresets";
import { monthPeriod, quarterPeriod, fyPeriod, quarterOf } from "@/lib/analytics/periodPresets";

function monthInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const [type, setType] = useState<PeriodType>(value.type);

  useEffect(() => setType(value.type), [value.type]);

  function changeType(next: PeriodType) {
    setType(next);
    const now = new Date();
    if (next === "MONTH") onChange(monthPeriod(now.getFullYear(), now.getMonth()));
    else if (next === "FY") onChange(fyPeriod(quarterOf(now).fyStartYear));
    else onChange(quarterPeriod(quarterOf(now).fyStartYear, quarterOf(now).quarter));
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={type}
        onChange={(e) => changeType(e.target.value as PeriodType)}
        className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
      >
        <option value="MONTH">Month</option>
        <option value="QUARTER">Quarter</option>
        <option value="FY">Fiscal year</option>
      </select>

      {type === "MONTH" && (
        <input
          type="month"
          value={monthInputValue(value.start)}
          onChange={(e) => {
            const [y, m] = e.target.value.split("-").map(Number);
            if (y && m) onChange(monthPeriod(y, m - 1));
          }}
          className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
        />
      )}

      {type === "QUARTER" &&
        (() => {
          const { fyStartYear, quarter } = quarterOf(value.start);
          return (
            <>
              <select
                value={quarter}
                onChange={(e) => onChange(quarterPeriod(fyStartYear, Number(e.target.value) as 1 | 2 | 3 | 4))}
                className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
              >
                <option value={1}>Q1 (Apr-Jun)</option>
                <option value={2}>Q2 (Jul-Sep)</option>
                <option value={3}>Q3 (Oct-Dec)</option>
                <option value={4}>Q4 (Jan-Mar)</option>
              </select>
              <input
                type="number"
                value={fyStartYear}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  if (Number.isFinite(y)) onChange(quarterPeriod(y, quarter));
                }}
                className="w-24 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
              />
            </>
          );
        })()}

      {type === "FY" && (
        <input
          type="number"
          value={quarterOf(value.start).fyStartYear}
          onChange={(e) => {
            const y = Number(e.target.value);
            if (Number.isFinite(y)) onChange(fyPeriod(y));
          }}
          className="w-24 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
        />
      )}

      <span className="text-sm text-slate-500">{value.label}</span>
    </div>
  );
}
