// Number formatters shared by the analytics screens. They live here, not in
// src/components/analytics/charts.tsx, so pages that only need to print a
// number don't pull the charts library (~106 kB) into their bundle.

export function fmtInr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
export function fmtPct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}
export function fmtDays(n: number | null): string {
  return n == null ? "—" : n < 1 ? `${Math.round(n * 24)}h` : `${n.toFixed(1)}d`;
}
// A duration in seconds → compact "3h 42m" / "18m" / "0m" (used by Rep Usage).
export function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
