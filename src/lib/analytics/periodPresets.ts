// Shared period-boundary math for the Targets admin screen and the
// Overview tab's period picker. Both need periodStart to land on the exact
// same calendar boundary — targets.ts's getTargetProgress/upsertTarget key
// a Target row on an exact periodStart date via a compound unique index,
// not a date range, so "pick any date in July" and "pick July 1st" would
// silently fail to match. Pure date math, no Prisma — importable from
// client components, same convention as fiscalYear.ts.
import { fyContaining } from "./fiscalYear";

// "ALL" is deliberately NOT a Target-alignable period — no Target row keys on
// an all-time boundary — so getTargetProgress finds no match and the Overview
// simply renders its existing "no target" state. It's the default so the
// Overview opens on all-time data, not the current month.
export type PeriodType = "ALL" | "MONTH" | "QUARTER" | "FY";
export type Period = { type: PeriodType; start: Date; end: Date; label: string };

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Wide fixed floor (matches the analytics routes' all-time fallback) → now.
export function allTimePeriod(): Period {
  return { type: "ALL", start: new Date("2000-01-01T00:00:00Z"), end: new Date(), label: "All time" };
}

export function monthPeriod(year: number, monthIndex: number): Period {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  return { type: "MONTH", start, end, label: `${MONTH_NAMES[monthIndex]} ${year}` };
}

// Quarters aligned to this business's Apr–Mar fiscal year (fiscalYear.ts),
// not the calendar year: Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar.
export function quarterPeriod(fyStartYear: number, quarter: 1 | 2 | 3 | 4): Period {
  const startMonth = 3 + (quarter - 1) * 3; // 3, 6, 9, 12
  const year = fyStartYear + Math.floor(startMonth / 12);
  const month = startMonth % 12;
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 3, 0, 23, 59, 59, 999);
  const fyLabel = `FY${String(fyStartYear).slice(-2)}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`;
  return { type: "QUARTER", start, end, label: `Q${quarter} ${fyLabel}` };
}

export function fyPeriod(fyStartYear: number): Period {
  const fy = fyContaining(new Date(fyStartYear, 3, 15));
  return { type: "FY", start: fy.start, end: fy.end, label: fy.label };
}

// Reverse of quarterPeriod — reconstructs which FY-quarter a stored
// periodStart falls in, so the picker can show the right selection when
// editing/loading an existing Target row instead of always resetting to
// "this quarter."
export function quarterOf(date: Date): { fyStartYear: number; quarter: 1 | 2 | 3 | 4 } {
  const fy = fyContaining(date);
  const fyStartYear = fy.start.getFullYear();
  const monthsSinceFYStart = (date.getFullYear() - fyStartYear) * 12 + (date.getMonth() - 3);
  const quarter = (Math.floor(monthsSinceFYStart / 3) + 1) as 1 | 2 | 3 | 4;
  return { fyStartYear, quarter };
}

export function describePeriod(type: PeriodType, start: Date): string {
  if (type === "ALL") return "All time";
  if (type === "MONTH") return `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`;
  if (type === "FY") return fyContaining(start).label;
  const { fyStartYear, quarter } = quarterOf(start);
  return quarterPeriod(fyStartYear, quarter).label;
}

export function currentPeriod(type: PeriodType): Period {
  const now = new Date();
  if (type === "ALL") return allTimePeriod();
  if (type === "MONTH") return monthPeriod(now.getFullYear(), now.getMonth());
  if (type === "FY") return fyPeriod(fyContaining(now).start.getFullYear());
  const { fyStartYear, quarter } = quarterOf(now);
  return quarterPeriod(fyStartYear, quarter);
}
