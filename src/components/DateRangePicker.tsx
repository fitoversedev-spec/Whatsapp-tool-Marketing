"use client";

import { useState, useEffect } from "react";

export type DateRange = { from: string; to: string }; // "YYYY-MM-DD"

function fmtDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function defaultDateRange(days: number): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: fmtDateInput(from), to: fmtDateInput(to) };
}

// Two native date inputs (clicking either opens the browser's own calendar
// picker) + an Apply button, so the parent only refetches once both ends
// are chosen rather than on every keystroke.
export default function DateRangePicker({ value, onApply }: { value: DateRange; onApply: (range: DateRange) => void }) {
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);

  useEffect(() => {
    setFrom(value.from);
    setTo(value.to);
  }, [value.from, value.to]);

  const dirty = from !== value.from || to !== value.to;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <input
        type="date"
        value={from}
        max={to}
        onChange={(e) => setFrom(e.target.value)}
        className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
        aria-label="Start date"
      />
      <span className="text-slate-400 text-sm">to</span>
      <input
        type="date"
        value={to}
        min={from}
        onChange={(e) => setTo(e.target.value)}
        className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
        aria-label="End date"
      />
      <button
        onClick={() => onApply({ from, to })}
        disabled={!dirty || !from || !to}
        className="bg-wa-green hover:bg-wa-green/90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-3 py-1.5 rounded-lg"
      >
        Apply
      </button>
    </div>
  );
}
