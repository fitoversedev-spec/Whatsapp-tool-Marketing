// Phase 5 (analytics v2) — the deterministic insight engine (A11). This is
// the LAST phase on purpose: it does NOT invent analytics, it COMPOSES the
// signals every prior phase already produces into a single actionable feed.
// Two sources feed it today:
//   1. anomalies.ts's 4 rules (Phase 3) — the "something changed" family.
//   2. targets.ts's pace/gap math, surfaced via kpiBoard.ts (Phase 1) — the
//      "you're off plan" family, plus a structural pipeline-shortfall check.
//
// DETERMINISTIC, RULE-BASED — there are NO LLM/AI calls anywhere in this file.
// Every recommendedAction is a templated string owned by the rule that emits
// it, not generated prose. That is the whole governance point: an insight the
// business can't act on (no "so what do I do") is a bug, so recommendedAction
// is a required, never-empty field on every Insight this engine returns.
import type { Role } from "@/lib/rbac";
import { resolveAnalyticsScope } from "./scope";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";
import {
  enquiriesUpWinsFlat,
  sourceWinRateDecay,
  cycleTimeSpike,
  repActivityUpConversionDown,
  type Anomaly,
} from "./anomalies";
import { getKpiBoard } from "./kpiBoard";
import type { TargetProgress } from "./targets";

export type Insight = {
  // Stable deterministic key: `${ruleName}:${subject}`. The same underlying
  // condition produces the same id across runs, so a DecisionLog row can
  // reference the insight that triggered it and repeat runs can dedup rather
  // than pile up duplicate cards.
  id: string;
  category: "anomaly" | "target" | "comparison" | "pipeline";
  severity: "info" | "warning";
  title: string;
  detail: string;
  recommendedAction: string; // MANDATORY, never empty — the governance contract.
  drillHref: string | null;
  n: number; // sample size behind the insight, for low-confidence display.
};

// Visible defaults, not confirmed business thresholds — same status as
// anomalies.ts's own per-rule cutoffs. Documented here so a future reader
// tunes a number, not a hidden constant buried in a branch.
const BEHIND_PACE_WARNING_RATIO = 0.25; // ≥25% short of the expected-by-now pace escalates info → warning.

// The drill-to-deals contract is exactly the query params
// crm/analytics/deals/page.tsx parses (productId/sportId/city/
// customerProfileId/stageId/outcome/from/to) — no owner/source/rep param
// exists there by design, so any insight keyed on a rep or a lead source has
// no honest drill target and carries drillHref: null rather than a link that
// would silently show the wrong (unscoped) deal set.
function dealsHref(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const q = qs.toString();
  return q ? `/crm/analytics/deals?${q}` : "/crm/analytics/deals";
}

// Local-time YYYY-MM-DD, matching how the drill page re-parses it
// (`new Date(from + "T00:00:00")`). toISOString() is deliberately NOT used —
// its UTC shift can move the boundary to the previous day for IST callers.
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function inr(v: number): string {
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

// Per-rule headline + recommendedAction + drill mapping for the anomaly
// family. Kept as one table (not scattered per rule) so the "every card has a
// non-empty action" rule is verifiable at a glance. `scopedToSelf` is true for
// a non-admin caller, whose deal set the drill page force-scopes to their own
// rows anyway — so a rep-keyed anomaly (which for them can only be about
// themselves) gets an honest open-pipeline drill, while the same anomaly in an
// admin's company-wide feed (about some other rep) stays null.
function anomalyToInsight(a: Anomaly, filter: AnalyticsFilter, scopedToSelf: boolean): Insight {
  const from = ymd(filter.from);
  const to = ymd(filter.to);

  let title: string;
  let recommendedAction: string;
  let drillHref: string | null;

  switch (a.rule) {
    case "enquiriesUpWinsFlat":
      title = "Enquiries rising, wins aren't";
      recommendedAction =
        "Lead volume is up but conversion isn't keeping pace — review qualification and follow-up speed on this period's open enquiries.";
      // The new-but-unclosed enquiries from exactly this window.
      drillHref = dealsHref({ outcome: "open", from, to });
      break;
    case "sourceWinRateDecay":
      title = `Win rate slipping from ${a.subject}`;
      recommendedAction = `Win rate from ${a.subject} is dropping — audit recent lost deals from this source and check whether its lead quality has changed.`;
      // No leadSourceId param in the drill contract → no honest source-scoped
      // deal set; a generic lost-deals link would show every source's losses.
      drillHref = null;
      break;
    case "cycleTimeSpike":
      title = "Deals closing slower";
      recommendedAction =
        "Average time-to-close is climbing — work the mid-funnel deals that are sitting too long and clear the bottleneck stages.";
      drillHref = dealsHref({ outcome: "open" });
      break;
    case "repActivityUpConversionDown":
      title = `${a.subject}: more activity, lower conversion`;
      recommendedAction = `${a.subject} is doing more (calls/visits/samples) but converting less — review deal quality and coaching, not just activity volume.`;
      // Admin's feed points at some other rep the drill page can't scope to,
      // so null there; a non-admin's is about themselves and their own deals.
      drillHref = scopedToSelf ? dealsHref({ outcome: "open" }) : null;
      break;
    default:
      // Defensive only: a rule added to anomalies.ts without a mapping here
      // still surfaces (with its own detail + a generic action) rather than
      // being silently dropped, so the miss is visible, not lost.
      title = a.subject;
      recommendedAction = "Review the deals behind this signal and decide whether it needs action.";
      drillHref = null;
  }

  return {
    id: `${a.rule}:${a.subject}`,
    category: "anomaly",
    severity: a.severity,
    title,
    detail: a.detail,
    recommendedAction,
    drillHref,
    n: a.n,
  };
}

// The target/pipeline family, derived entirely from kpiBoard's already-scoped
// TargetProgress — pace and gap math is NOT recomputed here (targets.ts owns
// it). subjectId keys the insight to whichever Target row kpiBoard actually
// read: a single-rep scope → that rep's id, anything broader → "company",
// mirroring kpiBoard's own targetScope choice so the ids line up.
function targetInsights(tp: TargetProgress, subjectId: string): Insight[] {
  const insights: Insight[] = [];

  // No Target row for this scope/period → nothing to be "off plan" against.
  if (tp.targetRevenue == null || tp.paceExpected == null || tp.gapToTarget == null) return insights;
  // Target already met — a hit target is not an actionable insight.
  if (tp.gapToTarget <= 0) return insights;

  const behindBy = tp.paceExpected - tp.wonRevenue;
  if (behindBy > 0) {
    const ratio = tp.paceExpected > 0 ? behindBy / tp.paceExpected : 0;
    insights.push({
      id: `targetBehindPace:${subjectId}`,
      category: "target",
      severity: ratio >= BEHIND_PACE_WARNING_RATIO ? "warning" : "info",
      title: "Behind target pace",
      detail: `Won ${inr(tp.wonRevenue)} so far vs ${inr(tp.paceExpected)} expected by now (target ${inr(
        tp.targetRevenue,
      )}); ${inr(tp.gapToTarget)} still to go, behind pace by ${inr(behindBy)}.`,
      recommendedAction: `Prioritise the open pipeline to recover ${inr(
        behindBy,
      )} — ${inr(tp.openPipelineValue)} of open deals is available to close the gap.`,
      drillHref: dealsHref({ outcome: "open" }),
      n: tp.wonDeals,
    });
  }

  // Structural shortfall: even winning 100% of the open pipeline wouldn't
  // cover what's left of the target. A comparison of two numbers kpiBoard
  // already returns — deterministic, not new analytics — but categorically
  // different from "behind pace" (which more effort can fix), so its own card.
  if (tp.openPipelineValue < tp.gapToTarget) {
    insights.push({
      id: `pipelineShortfall:${subjectId}`,
      category: "pipeline",
      severity: "warning",
      title: "Pipeline can't cover the target gap",
      detail: `Open pipeline is ${inr(tp.openPipelineValue)} but ${inr(
        tp.gapToTarget,
      )} of target remains — even at a 100% win rate the current pipeline falls short.`,
      recommendedAction:
        "Add new qualified enquiries or revisit the target — the current open pipeline cannot close this gap even if every open deal is won.",
      drillHref: dealsHref({ outcome: "open" }),
      n: tp.wonDeals,
    });
  }

  return insights;
}

// Scope-safe by construction: resolveAnalyticsScope runs FIRST and a
// non-admin's ownerIds is forced to [user.id] before any rule sees the filter,
// so a rep's personal-scope insight feed (embedded in their Performance→
// Overview per the plan's nav table) can never leak another rep's numbers —
// exactly the same merge rule kpiBoard/the analytics API routes use.
export async function generateInsights(
  user: { id: string; role: Role },
  filter: AnalyticsFilter,
): Promise<Insight[]> {
  const scope = resolveAnalyticsScope(user);
  // A caller-supplied ownerIds can only ever NARROW an admin's view; for a
  // non-admin, scope.ownerIds (always just [user.id]) wins outright.
  const ownerIds = scope.companyWide ? filter.ownerIds : scope.ownerIds;
  const scopedFilter: AnalyticsFilter = { ...filter, ownerIds };
  const scopedToSelf = !scope.companyWide;

  // The anomaly family runs against the scoped filter. The target family goes
  // through getKpiBoard (which re-applies the identical scope internally and
  // owns the periodType inference + Target-row selection) so pace/gap math is
  // reused, not duplicated. kpiBoard's period is the same date range every
  // analytics screen already passes.
  const [anomalyGroups, kpi] = await Promise.all([
    Promise.all([
      enquiriesUpWinsFlat(scopedFilter),
      sourceWinRateDecay(scopedFilter),
      cycleTimeSpike(scopedFilter),
      repActivityUpConversionDown(scopedFilter),
    ]),
    getKpiBoard(user, filter, { start: filter.from, end: filter.to }),
  ]);

  const anomalyInsights = anomalyGroups
    .flat()
    .map((a) => anomalyToInsight(a, scopedFilter, scopedToSelf));

  const targetSubjectId = ownerIds && ownerIds.length === 1 ? ownerIds[0] : "company";
  const planInsights = kpi.targetProgress ? targetInsights(kpi.targetProgress, targetSubjectId) : [];

  const all = [...anomalyInsights, ...planInsights];

  // Warnings first, then by sample size desc so the most-supported signals
  // lead within a severity. Low-n insights are NOT dropped — they surface with
  // their real n so the UI can mark them low-confidence (matching Phase 3's
  // quadrant convention), never presented as if they were confident.
  const severityRank = (s: Insight["severity"]) => (s === "warning" ? 0 : 1);
  all.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.n - a.n);

  return all;
}

// Re-exported so a UI/digest consumer can gate low-confidence styling on the
// same threshold the rest of the analytics layer uses, without importing
// types.ts separately just for this one constant.
export { MIN_SAMPLE_SIZE };
