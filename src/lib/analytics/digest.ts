// Phase 5 (analytics v2) — composes the week's headline ONCE so the in-app
// Digest tab and the weekly email render from the exact same object (the
// plan's explicit "composes the week's top insights + KPI headline once,
// reused by both"). Pure/deterministic: no AI, no LLM call anywhere here —
// the headline is a fixed template over numbers getKpiBoard already computes.
//
// DECOUPLING: this file does NOT import generateInsights from insights.ts.
// insights.ts is built in parallel and the two must not race on each other's
// on-disk presence at tsc time; more importantly, keeping the insight source
// out of here makes buildDigest trivially testable and lets the composition
// happen at the call site (the cron sweep / API route passes both the filter
// and the already-generated insights in). digest.ts owns the KPI headline;
// the caller owns insight generation. One seam, two responsibilities.
import type { Role } from "@/lib/rbac";
import type { AnalyticsFilter } from "./types";
import { getKpiBoard } from "./kpiBoard";
import type { TargetProgress } from "./targets";

// Projection of whatever generateInsights (insights.ts, built in parallel)
// produces — the caller maps its richer Insight down to this before passing
// it in, so digest.ts never depends on that file's shape. `n` is optional
// because the plan requires trimming "by severity then n desc": it carries
// the underlying sample size (from the Anomaly.n that seeded the insight) so
// the sort can honour it; a caller that omits it is treated as n=0 (sorts
// last within its severity band) rather than crashing the sort.
export type DigestInsight = {
  title: string;
  detail: string;
  recommendedAction: string;
  severity: "info" | "warning";
  n?: number;
};

export type DigestData = {
  periodLabel: string; // e.g. "Week of 21 Jul 2026"
  wonRevenue: number;
  winRate: { rate: number | null; n: number };
  targetPaceLine: string | null; // "On pace" / "Behind by ₹X" / null if no target
  topInsights: DigestInsight[]; // the passed-in insights, trimmed to the top N by severity then n
  headline: string; // one-sentence plain-language summary of the week
};

// How many insights the digest carries — a headline surface, not the full
// feed (that lives on the in-app Insight Feed tab), so this stays a
// documented default rather than a magic number.
const TOP_INSIGHTS = 5;

// Local INR formatter rather than importing charts.tsx's fmtInr — that module
// is a client component ("use client"), and digest.ts is server-only lib code
// consumed by the cron sweep and the email template; pulling a client module
// into it would be a layering violation for a one-line format.
function fmtInr(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// "Week of 21 Jul 2026" — labelled off the period START (filter.from), the
// same date the digest window opens on. en-GB gives day-month-year order.
function weekLabel(from: Date): string {
  return "Week of " + from.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Warnings ahead of info, then larger sample first — a stable, deterministic
// order (no ties broken by array position leaking through).
function severityRank(s: "info" | "warning"): number {
  return s === "warning" ? 0 : 1;
}

export async function buildDigest(
  user: { id: string; role: Role },
  filter: AnalyticsFilter,
  insights: DigestInsight[],
): Promise<DigestData> {
  // Reuse getKpiBoard verbatim for the revenue/winRate/target numbers — it
  // applies the same resolveAnalyticsScope path every other screen does, so a
  // non-admin's digest can only ever contain their own scoped numbers even if
  // the passed filter tried to widen them. No direct Prisma re-query here for
  // anything the KPI board already owns.
  const board = await getKpiBoard(user, filter, { start: filter.from, end: filter.to });

  const topInsights = [...insights]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || (b.n ?? 0) - (a.n ?? 0))
    .slice(0, TOP_INSIGHTS);

  const targetPaceLine = paceLine(board.targetProgress);
  const headline = composeHeadline(weekLabel(filter.from), board.wonRevenue, board.winRate, targetPaceLine, topInsights);

  return {
    periodLabel: weekLabel(filter.from),
    wonRevenue: board.wonRevenue,
    winRate: board.winRate,
    targetPaceLine,
    topInsights,
    headline,
  };
}

// null when there's no target to pace against (no Target row for this
// scope/period) — the KPI board already surfaces that as targetProgress:null
// or targetRevenue:null. Otherwise compare actual won vs the elapsed-adjusted
// expectation getTargetProgress already computed (paceExpected), not the flat
// full-period target, so "on pace" means on pace for where we are in the week.
function paceLine(tp: TargetProgress | null): string | null {
  if (!tp || tp.targetRevenue == null || tp.paceExpected == null) return null;
  if (tp.wonRevenue >= tp.paceExpected) return "On pace";
  return "Behind by " + fmtInr(tp.paceExpected - tp.wonRevenue);
}

function composeHeadline(
  label: string,
  wonRevenue: number,
  winRate: { rate: number | null; n: number },
  targetPaceLine: string | null,
  topInsights: DigestInsight[],
): string {
  const winPhrase =
    winRate.rate != null
      ? `${Math.round(winRate.rate * 100)}% win rate`
      : `win rate pending (only ${winRate.n} closed)`;
  const pacePhrase =
    targetPaceLine == null
      ? ""
      : targetPaceLine === "On pace"
        ? ", on pace against target"
        : `, ${targetPaceLine.toLowerCase()} against target`;
  const signalPhrase = topInsights.length
    ? `; top signal: ${topInsights[0].title}`
    : "; no notable signals this week";
  return `${label}: ${fmtInr(wonRevenue)} won, ${winPhrase}${pacePhrase}${signalPhrase}.`;
}
