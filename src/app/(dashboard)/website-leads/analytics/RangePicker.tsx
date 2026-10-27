"use client";

import { useState } from "react";
import { addDays, addMonths, MAX_MONTHS_BACK, todayIST } from "@/lib/website-analytics/range";
import type { RangeChoice } from "./helpers";

const PRESETS: { key: RangeChoice["preset"]; label: string }[] = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
];

const PILL = "px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap";
const DATE_INPUT =
  "border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-wa-green/30 focus:border-wa-green";

// Last 7 days / Last 30 days / This month / Last month, or Custom with two dates
// (applied with the Apply button, so a half-picked range never reloads anything).
export default function RangePicker({ value, onChange }: { value: RangeChoice; onChange: (r: RangeChoice) => void }) {
  const today = todayIST();
  const min = addMonths(today, -MAX_MONTHS_BACK); // the same limit the server checks
  const [customOpen, setCustomOpen] = useState(value.preset === "custom");
  const [from, setFrom] = useState(value.preset === "custom" ? value.from : addDays(today, -29));
  const [to, setTo] = useState(value.preset === "custom" ? value.to : today);

  const filled = from !== "" && to !== "";
  const valid = filled && from <= to && to <= today && from >= min;
  const dirty = value.preset !== "custom" || from !== value.from || to !== value.to;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              setCustomOpen(false);
              onChange({ preset: p.key, from: "", to: "" });
            }}
            aria-pressed={value.preset === p.key}
            className={`${PILL} ${value.preset === p.key ? "bg-court-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustomOpen((o) => !o)}
          aria-pressed={value.preset === "custom"}
          aria-expanded={customOpen}
          className={`${PILL} ${value.preset === "custom" ? "bg-court-600 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          Custom
        </button>
      </div>

      {customOpen && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <input
            type="date"
            value={from}
            min={min}
            max={to || today}
            onChange={(e) => setFrom(e.target.value)}
            className={DATE_INPUT}
            aria-label="Start date"
          />
          <span className="text-slate-400 text-sm">to</span>
          <input
            type="date"
            value={to}
            min={from || min}
            max={today}
            onChange={(e) => setTo(e.target.value)}
            className={DATE_INPUT}
            aria-label="End date"
          />
          <button
            type="button"
            onClick={() => onChange({ preset: "custom", from, to })}
            disabled={!valid || !dirty}
            className="btn btn-primary !px-4 !py-1.5 !text-sm"
          >
            Apply
          </button>
          {filled && !valid && (
            <span className="text-xs text-red-600">
              {from > to
                ? "The start date must not be after the end date."
                : to > today
                  ? "The end date can't be in the future."
                  : `The start date can't be more than ${MAX_MONTHS_BACK} months ago.`}
            </span>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500">Compared with the previous period</p>
    </div>
  );
}
