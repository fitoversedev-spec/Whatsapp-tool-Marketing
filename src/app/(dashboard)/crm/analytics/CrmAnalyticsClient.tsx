"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import DateRangePicker, { defaultDateRange, type DateRange } from "@/components/DateRangePicker";
import { HorizontalBarChart, StackedBarChart, DonutChart, DONUT_PALETTE, QuadrantScatter, BubbleChart, fmtInr, fmtPct, fmtDays } from "@/components/analytics/charts";
import { DataTable } from "@/components/analytics/DataTable";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import { AnalyticsCard } from "@/components/analytics/AnalyticsCard";
import { PeriodPicker } from "@/components/analytics/PeriodPicker";
import { currentPeriod, type Period } from "@/lib/analytics/periodPresets";
import { MIN_SAMPLE_SIZE } from "@/lib/analytics/types";
import type { Role } from "@/lib/rbac";

type SalesActivityRow = {
  ownerId: string; ownerName: string; leadsCreated: number; dealsCreated: number; siteVisits: number;
  quotationsSentInclRevisions: number; quotedValue: number; dealsWon: number; dealsClosed: number;
  wonValue: number; winRate: number | null; avgCycleDays: number | null;
};
type FunnelStageRow = { stageId: string; stageName: string; stageType: string; stageColorHex: string | null; count: number; value: number };
type SourceRow = { sourceName: string; leads: number; qualified: number; deals: number; quoted: number; won: number; wonValue: number; leadToWonRate: number | null };
type ProductConversionRow = { productName: string; enquiries: number; quoted: number; won: number; conversionRate: number | null; flagged: boolean };
type ProductCityCell = { productName: string; city: string; wonValue: number; enquiries: number };
type ProductMovementRow = { month: string; productName: string; enquiries: number; quoted: number; quotedValue: number; won: number; wonValue: number };
export type StageVelocityRow = { stageId: string; stageName: string; sortOrder: number; medianDays: number | null; p90Days: number | null; n: number };
type CityRow = {
  city: string; enquiries: number; quotations: number; won: number; wonValue: number;
  winRate: number | null; avgDealSize: number | null; avgCycleDays: number | null;
};

type AnalyticsResponse = {
  isAdmin: boolean;
  salesActivity: SalesActivityRow[];
  funnel: { stages: FunnelStageRow[]; lossReasons: { reasonName: string; count: number }[] };
  products: { conversion: ProductConversionRow[]; cityHeatmap: ProductCityCell[]; movement: ProductMovementRow[] };
  sources: { sources: SourceRow[] };
  stageVelocity: StageVelocityRow[];
  geography: { cities: CityRow[] };
};

// Comparators & Patterns group (Phase 2) — response shape of
// /api/crm/analytics/patterns, admin-only. Row types are redefined here
// rather than imported from src/lib/analytics/*.ts, matching how every
// other row type above is duplicated client-side instead of imported.
type RepComparisonRow = {
  ownerId: string; ownerName: string; wonRevenue: number;
  winRate: { rate: number | null; n: number };
  avgCycleDays: { days: number | null; n: number };
  avgProjectValue: number | null;
};
type DimensionComparisonRow = { label: string; enquiries: number; won: number; wonValue: number; winRate: number | null };
type Dimension = "region" | "sector" | "product" | "source";
// Benchmarks itself is declared once, further below, alongside
// OverviewTab's own types — reused here rather than redeclared.
type FyBenchmark = Benchmarks & { label: string };
type SegmentFunnelRow = { stageId: string; stageName: string; sortOrder: number; profileName: string; count: number; value: number };
type SourcePathRow = { stageId: string; stageName: string; sortOrder: number; sourceName: string; count: number; value: number };
type ValueFunnelRow = { stageId: string; stageName: string; sortOrder: number; count: number; value: number };
type CohortStageCell = {
  stageId: string; stageName: string; sortOrder: number;
  reachedCount: number; reachedPct: number | null; medianDaysToReach: number | null; p90DaysToReach: number | null;
};
type EnquiryCohortRow = { month: string; cohortSize: number; insufficientData: boolean; stages: CohortStageCell[] };
type RepeatPurchaseRow = { pairIndex: number; label: string; medianDays: number | null; p90Days: number | null; n: number };

type PatternsResponse = {
  repComparison: RepComparisonRow[];
  dimensions: Record<Dimension, DimensionComparisonRow[]>;
  fyComparison: { current: FyBenchmark; previous: FyBenchmark };
  funnel: { segments: SegmentFunnelRow[]; sourcePaths: SourcePathRow[]; valueByStage: ValueFunnelRow[] };
  cohorts: { enquiry: EnquiryCohortRow[]; repeatPurchase: RepeatPurchaseRow[] };
};

// Quadrants & Territory group (Phase 3) — response shape of
// /api/crm/analytics/quadrants, admin-only, same duplicated-row-type
// convention as PatternsResponse above (row types redefined client-side
// rather than imported from src/lib/analytics/*.ts).
type QuadrantPointRow = { id: string; label: string; x: number; y: number; n: number };
type QuadrantResultRow = { points: QuadrantPointRow[]; xBenchmark: number; yBenchmark: number; xLabel: string; yLabel: string; lowConfidenceIds: string[] };
type TerritoryBubbleRow = { city: string; avgDealSize: number | null; winRate: number | null; enquiryVolume: number; n: number };
type QuadrantsResponse = {
  leadSource: QuadrantResultRow;
  product: QuadrantResultRow;
  rep: QuadrantResultRow;
  region: QuadrantResultRow;
  territory: TerritoryBubbleRow[];
};

// Industry Insights group (Phase 4) — response shape of
// /api/crm/analytics/insights, admin-only, same duplicated-row-type
// convention as PatternsResponse/QuadrantsResponse above.
type SeasonalityRow = { sportName: string; month: number; enquiries: number; won: number; wonValue: number };
type SeasonalityResult = { rows: SeasonalityRow[]; seasonalIndex: Record<string, number[]> | null; distinctYears: number[] };
type ReferralRow = { sourceDetail: string; enquiries: number; won: number; wonValue: number; winRate: number | null };
type ReferralScoreboard = { rows: ReferralRow[]; distinctValueCount: number; likelyFragmented: boolean };
type ProfileFingerprintRow = {
  profileName: string;
  customerProfileId: string | null;
  dealCount: number;
  dominantSports: string[];
  dominantProducts: string[];
  avgAreaSqFt: number | null;
  avgWonValue: number | null;
  dominantSource: string;
};
type WinLossSegmentRow = { segmentLabel: string; reasonName: string; wonCount: number; lostCount: number; customerProfileId?: string | null };
type WinLossDimension = "sector" | "region" | "product";
type DurationStat = { medianDays: number | null; p90Days: number | null; n: number };
type ExecutionSummary = { backlogValue: number; backlogCount: number; deliveryTime: DurationStat; bookedRevenue: number; deliveredRevenue: number };
type InsightsResponse = {
  seasonality: SeasonalityResult;
  referral: ReferralScoreboard;
  fingerprint: ProfileFingerprintRow[];
  winLoss: Record<WinLossDimension, WinLossSegmentRow[]>;
  execution: ExecutionSummary;
};

// Insights & Digest group (Phase 5) — response shape of
// /api/crm/analytics/insightfeed. Unlike PatternsResponse/QuadrantsResponse/
// InsightsResponse above (all admin-only routes), this route is NOT hard
// admin-gated: generateInsights is scope-safe, so a non-admin gets their own
// personal-scope insights (consumed by OverviewTab's embedded card) while an
// admin gets the full company-wide feed. Same duplicated-row-type convention.
type InsightRow = {
  id: string;
  category: "anomaly" | "target" | "comparison" | "pipeline";
  severity: "info" | "warning";
  title: string;
  detail: string;
  recommendedAction: string;
  drillHref: string | null;
  n: number;
};
type DigestInsightRow = { title: string; detail: string; recommendedAction: string; severity: "info" | "warning"; n?: number };
type DigestDataRow = {
  periodLabel: string;
  wonRevenue: number;
  winRate: { rate: number | null; n: number };
  targetPaceLine: string | null;
  topInsights: DigestInsightRow[];
  headline: string;
};
type InsightFeedResponse = {
  isAdmin: boolean;
  emailConfigured: boolean;
  insights: InsightRow[];
  digest: DigestDataRow;
};
type DecisionRow = {
  id: string;
  decision: string;
  triggeredByInsightId: string | null;
  decidedAt: string;
  recordedByName: string;
};

const PERFORMANCE_TABS = ["overview", "overall", "individual", "geography", "products", "platforms"] as const;
const PATTERNS_TABS = ["comparators", "funnelPatterns", "cohorts"] as const;
const QUADRANTS_TABS = ["fourQuadrants", "territory"] as const;
const INSIGHTS_TABS = ["seasonality", "referralPartners", "requirementFingerprint", "winLossSegment", "executionPipeline"] as const;
// Phase 5's Insights & Digest group. Tab keys are deliberately distinct from
// the "digest" GROUP key below (Tab and Group are separate unions, so there's
// no type collision — the different names just keep the two readable).
const DIGEST_TABS = ["insightFeed", "digestView", "decisionLog"] as const;
type PerformanceTab = (typeof PERFORMANCE_TABS)[number];
type PatternsTab = (typeof PATTERNS_TABS)[number];
type QuadrantsTab = (typeof QUADRANTS_TABS)[number];
type InsightsTab = (typeof INSIGHTS_TABS)[number];
type DigestGroupTab = (typeof DIGEST_TABS)[number];
type Tab = PerformanceTab | PatternsTab | QuadrantsTab | InsightsTab | DigestGroupTab;
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  individual: "Individual performance",
  overall: "Overall performance",
  products: "Best-selling products",
  geography: "Geography",
  platforms: "Platform performance",
  comparators: "Comparators",
  funnelPatterns: "Funnel patterns",
  cohorts: "Cohorts",
  fourQuadrants: "4 Quadrants",
  territory: "Territory",
  seasonality: "Seasonality",
  referralPartners: "Referral Partners",
  requirementFingerprint: "Requirement Fingerprint",
  winLossSegment: "Win/Loss by Segment",
  executionPipeline: "Execution Pipeline",
  insightFeed: "Insight Feed",
  digestView: "Digest",
  decisionLog: "Decision Log",
};

// Two-level nav (Phase 2, extended Phase 3, extended Phase 4): "Comparisons &
// Patterns", "Quadrants & Territory" and "Industry Insights" are all hidden
// in their entirety for non-admin — not rendered, not just disabled — per
// the plan's nav table. The group-selector row itself only renders when more
// than one group is visible, so a non-admin never sees any of them exist.
// Note: "insights" here is Phase 4's INDUSTRY-Insights group; "digest" is
// Phase 5's INSIGHT-FEED group ("Insights & Digest") — two different keys on
// purpose, so they never collide in visibleGroups/GROUP_LABELS.
type Group = "performance" | "patterns" | "quadrants" | "insights" | "digest";
const GROUP_LABELS: Record<Group, string> = {
  performance: "Performance",
  patterns: "Comparisons & Patterns",
  quadrants: "Quadrants & Territory",
  insights: "Industry Insights",
  digest: "Insights & Digest",
};

type TargetProgress = {
  targetRevenue: number | null;
  targetDeals: number | null;
  wonRevenue: number;
  wonDeals: number;
  paceExpected: number | null;
  gapToTarget: number | null;
  openPipelineValue: number;
  weightedPipelineValue: number | null;
  isPipelineWeighted: boolean;
};
type RepRankingRow = { ownerId: string; ownerName: string; wonRevenue: number; winRate: number | null; dealsWon: number };
type Benchmarks = { trailingWinRate: number | null; avgCycleDays: number | null; avgProjectValue: number | null };
type OverviewResponse = {
  isAdmin: boolean;
  wonRevenue: number;
  dealsCreated: number;
  targetProgress: TargetProgress | null;
  winRate: { rate: number | null; n: number };
  avgProjectValue: number | null;
  salesVelocity: number | null;
  repRankings: RepRankingRow[] | null;
  benchmarks: Benchmarks;
  // Non-admin-only "where you sit" embed (Phase 3) — the API never computes
  // this for an admin caller (see kpiBoard.ts's getKpiBoard), so it's always
  // null in an admin's response and always this-caller's-own point for a
  // non-admin's, never any other rep's.
  repQuadrantSelf: { x: number; y: number; n: number; xBenchmark: number; yBenchmark: number } | null;
};

function dealsHref(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const q = qs.toString();
  return q ? `/crm/analytics/deals?${q}` : "/crm/analytics/deals";
}

export default function CrmAnalyticsClient({ isAdmin, role }: { isAdmin: boolean; role: Role }) {
  const visibleGroups: Group[] = isAdmin
    ? ["performance", "patterns", "quadrants", "insights", "digest"]
    : ["performance"];

  const [range, setRange] = useState<DateRange>(() => defaultDateRange(30));
  const [group, setGroup] = useState<Group>("performance");
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [patternsData, setPatternsData] = useState<PatternsResponse | null>(null);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [quadrantsData, setQuadrantsData] = useState<QuadrantsResponse | null>(null);
  const [quadrantsLoading, setQuadrantsLoading] = useState(false);
  const [insightsData, setInsightsData] = useState<InsightsResponse | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightFeedData, setInsightFeedData] = useState<InsightFeedResponse | null>(null);
  const [insightFeedLoading, setInsightFeedLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/crm/analytics/performance?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [range]);

  // Fetched lazily, only once an admin actually opens the group — a
  // non-admin can never reach this branch since "patterns" never appears in
  // visibleGroups for them, and the route itself 403s them regardless.
  useEffect(() => {
    if (!isAdmin || group !== "patterns") return;
    setPatternsLoading(true);
    fetch(`/api/crm/analytics/patterns?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((d) => setPatternsData(d))
      .finally(() => setPatternsLoading(false));
  }, [range, group, isAdmin]);

  // Same lazy-fetch-only-once-opened pattern as patterns above — a
  // non-admin can never reach this branch since "quadrants" never appears in
  // visibleGroups for them, and the route itself 403s them regardless.
  useEffect(() => {
    if (!isAdmin || group !== "quadrants") return;
    setQuadrantsLoading(true);
    fetch(`/api/crm/analytics/quadrants?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((d) => setQuadrantsData(d))
      .finally(() => setQuadrantsLoading(false));
  }, [range, group, isAdmin]);

  // Same lazy-fetch-only-once-opened pattern as patterns/quadrants above — a
  // non-admin can never reach this branch since "insights" never appears in
  // visibleGroups for them, and the route itself 403s them regardless.
  useEffect(() => {
    if (!isAdmin || group !== "insights") return;
    setInsightsLoading(true);
    fetch(`/api/crm/analytics/insights?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((d) => setInsightsData(d))
      .finally(() => setInsightsLoading(false));
  }, [range, group, isAdmin]);

  // Same lazy-fetch-only-once-opened pattern as the admin groups above — a
  // non-admin can never reach this branch since "digest" never appears in
  // visibleGroups for them. The insightfeed ROUTE itself is intentionally not
  // 403-gated (the non-admin Overview card consumes it too), so this admin gate
  // is the client-side half of the group's admin-only visibility.
  useEffect(() => {
    if (!isAdmin || group !== "digest") return;
    setInsightFeedLoading(true);
    fetch(`/api/crm/analytics/insightfeed?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((d) => setInsightFeedData(d))
      .finally(() => setInsightFeedLoading(false));
  }, [range, group, isAdmin]);

  function selectGroup(g: Group) {
    setGroup(g);
    setTab(
      g === "performance"
        ? "overview"
        : g === "patterns"
          ? "comparators"
          : g === "quadrants"
            ? "fourQuadrants"
            : g === "insights"
              ? "seasonality"
              : "insightFeed",
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        large
        title="CRM Analytics"
        description={
          isAdmin
            ? "Individual and team performance, best sellers, and platform performance — across every channel, not just WhatsApp"
            : "Your own performance and activity."
        }
        action={<DateRangePicker value={range} onApply={setRange} />}
      />

      {visibleGroups.length > 1 && (
        <div className="flex gap-1.5 mt-4">
          {visibleGroups.map((g) => (
            <button
              key={g}
              onClick={() => selectGroup(g)}
              className={`px-3 py-1 text-xs font-medium rounded-full ${
                group === g ? "bg-wa-green text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {GROUP_LABELS[g]}
            </button>
          ))}
        </div>
      )}

      {/* Tab bar is admin-only. A non-admin (sales) user gets a single personal
          dashboard with no tabs and none of the team/products/geography/platform
          views — just their own Overview + Individual activity, rendered below. */}
      {isAdmin && (
        <div className="flex gap-1 border-b border-slate-200 mb-4 mt-4 overflow-x-auto">
          {(group === "performance"
            ? PERFORMANCE_TABS
            : group === "patterns"
              ? PATTERNS_TABS
              : group === "quadrants"
                ? QUADRANTS_TABS
                : group === "insights"
                  ? INSIGHTS_TABS
                  : DIGEST_TABS
          ).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
                tab === t ? "border-wa-green text-wa-dark" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      {/* Non-admin personal dashboard: OverviewTab (KPIs/targets/where-you-sit/
          insights) then their own IndividualTab row. Both are server-scoped to
          this rep — data.salesActivity for a non-admin only ever contains their
          own row (resolveAnalyticsScope), so no other rep's data is reachable. */}
      {!isAdmin && (
        <div className="mt-4 space-y-4">
          <OverviewTab isAdmin={false} />
          {loading || !data ? (
            <div className="text-sm text-slate-400 py-8 text-center">Loading...</div>
          ) : (
            <IndividualTab rows={data.salesActivity} range={range} isAdmin={false} />
          )}
        </div>
      )}

      {isAdmin && group === "performance" && tab === "overview" && <OverviewTab isAdmin={isAdmin} />}

      {isAdmin && group === "performance" && tab !== "overview" && (loading || !data ? (
        <div className="text-sm text-slate-400 py-8 text-center">Loading...</div>
      ) : (
        <>
          {tab === "individual" && <IndividualTab rows={data.salesActivity} range={range} isAdmin={isAdmin} />}
          {tab === "overall" && <OverallTab funnel={data.funnel} salesActivity={data.salesActivity} stageVelocity={data.stageVelocity} range={range} />}
          {tab === "products" && <ProductsTab rows={data.products.conversion} cityHeatmap={data.products.cityHeatmap} movement={data.products.movement} range={range} />}
          {tab === "geography" && <GeographyTab rows={data.geography.cities} range={range} />}
          {tab === "platforms" && <PlatformsTab rows={data.sources.sources} range={range} />}
        </>
      ))}

      {group === "patterns" && (patternsLoading || !patternsData ? (
        <div className="text-sm text-slate-400 py-8 text-center">Loading...</div>
      ) : (
        <>
          {tab === "comparators" && (
            <ComparatorsTab
              repRows={patternsData.repComparison}
              dimensions={patternsData.dimensions}
              fy={patternsData.fyComparison}
              range={range}
            />
          )}
          {tab === "funnelPatterns" && <FunnelPatternsTab funnel={patternsData.funnel} range={range} />}
          {tab === "cohorts" && <CohortsTab cohorts={patternsData.cohorts} range={range} />}
        </>
      ))}

      {group === "quadrants" && (quadrantsLoading || !quadrantsData ? (
        <div className="text-sm text-slate-400 py-8 text-center">Loading...</div>
      ) : (
        <>
          {tab === "fourQuadrants" && <FourQuadrantsTab data={quadrantsData} range={range} />}
          {tab === "territory" && <TerritoryTab rows={quadrantsData.territory} range={range} />}
        </>
      ))}

      {group === "insights" && (insightsLoading || !insightsData ? (
        <div className="text-sm text-slate-400 py-8 text-center">Loading...</div>
      ) : (
        <>
          {tab === "seasonality" && <SeasonalityTab data={insightsData.seasonality} />}
          {tab === "referralPartners" && <ReferralPartnersTab data={insightsData.referral} />}
          {tab === "requirementFingerprint" && <RequirementFingerprintTab rows={insightsData.fingerprint} range={range} />}
          {tab === "winLossSegment" && <WinLossSegmentTab winLoss={insightsData.winLoss} range={range} />}
          {tab === "executionPipeline" && <ExecutionPipelineTab data={insightsData.execution} range={range} />}
        </>
      ))}

      {group === "digest" && (insightFeedLoading || !insightFeedData ? (
        <div className="text-sm text-slate-400 py-8 text-center">Loading...</div>
      ) : (
        <>
          {tab === "insightFeed" && <InsightFeedTab insights={insightFeedData.insights} />}
          {tab === "digestView" && <DigestTab digest={insightFeedData.digest} emailConfigured={insightFeedData.emailConfigured} />}
          {tab === "decisionLog" && <DecisionLogTab insights={insightFeedData.insights} />}
        </>
      ))}
    </div>
  );
}

// --- Insights & Digest group (Phase 5, admin-only) ---

// Shared small presentational bits used by the Insight Feed, Digest and the
// non-admin Overview embed — a severity chip and a labelled KPI tile.
function SeverityPill({ severity }: { severity: "info" | "warning" }) {
  return (
    <span
      className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
        severity === "warning" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
      }`}
    >
      {severity === "warning" ? "Warning" : "Info"}
    </span>
  );
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-4">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// The admin's full company-scope feed. Each insight is its own AnalyticsCard so
// the mandatory recommended-action + drill-to-deals footer contract is applied
// structurally per card (recommendedAction → the card's `action` slot; the
// engine's drillHref → the card's link, or nothing when the engine honestly has
// no drill target). Low-n insights aren't dropped — they carry a low-confidence
// marker, matching the quadrant convention elsewhere in this build.
function InsightFeedTab({ insights }: { insights: InsightRow[] }) {
  if (insights.length === 0) {
    return (
      <AnalyticsCard
        title="Insight feed"
        description="Deterministic, rule-based signals composed from the anomaly rules and target pace across the selected range — no AI, every card carries a recommended action."
      >
        <p className="text-sm text-slate-400">No notable signals in this range right now — nothing is off pace or anomalous.</p>
      </AnalyticsCard>
    );
  }
  return (
    <div className="space-y-4">
      {insights.map((ins) => (
        <AnalyticsCard key={ins.id} title={ins.title} action={ins.recommendedAction} drillHref={ins.drillHref ?? undefined}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <SeverityPill severity={ins.severity} />
              {ins.n < MIN_SAMPLE_SIZE && <span className="text-xs text-amber-600">low confidence (n={ins.n})</span>}
            </div>
            <p className="text-sm text-slate-700">{ins.detail}</p>
          </div>
        </AnalyticsCard>
      ))}
    </div>
  );
}

// The in-app render of the exact DigestData the weekly email sends. The
// email-not-configured note comes from a server-side isEmailConfigured() check
// passed down as a boolean (emailConfigured) — the RESEND_API_KEY value is
// never sent to the client.
function DigestTab({ digest, emailConfigured }: { digest: DigestDataRow; emailConfigured: boolean }) {
  return (
    <AnalyticsCard
      title="Weekly digest"
      description="The same headline, KPI snapshot and top signals the weekly email sends — shown in-app here so it's useful even while email delivery is dormant."
    >
      {!emailConfigured && (
        <div className="mb-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          Weekly email delivery is not yet enabled — set RESEND_API_KEY in production to start sending this digest by email. The in-app view below always works.
        </div>
      )}
      <div className="space-y-4">
        <div className="bg-slate-50 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500 mb-1">{digest.periodLabel}</div>
          <p className="text-sm text-slate-800">{digest.headline}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KpiTile label="Won revenue" value={fmtInr(digest.wonRevenue)} />
          <KpiTile label="Win rate" value={fmtPct(digest.winRate.rate)} sub={`${digest.winRate.n} closed`} />
          <KpiTile label="Target pace" value={digest.targetPaceLine ?? "No target set"} />
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Top signals this week</h3>
          {digest.topInsights.length === 0 ? (
            <p className="text-sm text-slate-400">No notable signals this week.</p>
          ) : (
            <div className="space-y-2">
              {digest.topInsights.map((ins, i) => (
                <div key={i} className="border border-slate-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <SeverityPill severity={ins.severity} />
                    <span className="text-sm font-medium text-slate-900">{ins.title}</span>
                  </div>
                  <p className="text-xs text-slate-600">{ins.detail}</p>
                  <p className="text-xs text-slate-700 mt-1">
                    <span className="font-medium">Recommended:</span> {ins.recommendedAction}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AnalyticsCard>
  );
}

// Lists recorded decisions + a simple form to record a new one, mirroring
// /admin/targets' form/list style. The POST goes to /api/admin/decision-log,
// which writes through writeDecision (the decisionLog.ts chokepoint). The
// optional "triggered by" dropdown is seeded from the current feed's insight
// ids so a decision can be linked back to the signal that prompted it.
function DecisionLogTab({ insights }: { insights: InsightRow[] }) {
  const toast = useToast();
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [decision, setDecision] = useState("");
  const [insightId, setInsightId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/decision-log");
    if (res.ok) setDecisions((await res.json()).decisions);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (decision.trim() === "") {
      toast.error("Enter a decision to record");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/admin/decision-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: decision.trim(), triggeredByInsightId: insightId || null }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Decision recorded");
      setDecision("");
      setInsightId("");
      load();
    } else {
      toast.error("Failed to record decision");
    }
  }

  return (
    <div className="space-y-4">
      <AnalyticsCard
        title="Record a decision"
        description="Log what you decided to do in response to the insight feed — closing the loop from signal to action. Optionally link the insight that prompted it."
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Decision</label>
            <textarea
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              placeholder="e.g. Reassigned stalled Bengaluru turf enquiries to the senior rep and set a 3-day follow-up SLA."
              rows={3}
              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Triggered by insight (optional)</label>
            <select
              value={insightId}
              onChange={(e) => setInsightId(e.target.value)}
              className="w-full sm:w-auto border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
            >
              <option value="">— none —</option>
              {insights.map((ins) => (
                <option key={ins.id} value={ins.id}>
                  {ins.title}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={submit}
            disabled={saving}
            className="bg-wa-green hover:bg-wa-green/90 disabled:opacity-40 text-white text-sm font-medium px-4 py-1.5 rounded-lg"
          >
            {saving ? "Saving…" : "Record decision"}
          </button>
        </div>
      </AnalyticsCard>

      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Recorded decisions</h3>
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Loading…</div>
          ) : decisions.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">No decisions recorded yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="px-4 py-2.5 font-medium">Decision</th>
                  <th className="px-4 py-2.5 font-medium">Triggered by</th>
                  <th className="px-4 py-2.5 font-medium">Recorded by</th>
                  <th className="px-4 py-2.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => (
                  <tr key={d.id} className="border-b border-slate-100 last:border-0 align-top">
                    <td className="px-4 py-2.5 text-slate-800">{d.decision}</td>
                    <td className="px-4 py-2.5 text-slate-500">{d.triggeredByInsightId ?? "—"}</td>
                    <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">{d.recordedByName}</td>
                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{new Date(d.decidedAt).toLocaleDateString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// Pivots flat {x, group, value} rows into StackedBarChart's per-x-category
// shape, capping to the topN groups by total value (by revenue, almost
// always) and folding the remainder into "Other" — used by both the
// Products (x=month) and Geography/Comparators (x=a single "Won revenue"
// category, i.e. a one-bar 100% breakdown) stacked charts below, so the
// same pivot/cap logic isn't written three times.
const STACK_PALETTE = ["#25D366", "#73caf0", "#fbbf24", "#c81124", "#a78bfa", "#34d399", "#f472b6"];
type StackRow = { x: string; [k: string]: string | number };
function stackedSeries(rows: { x: string; group: string; value: number }[], topN: number) {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.group, (totals.get(r.group) ?? 0) + r.value);
  const topGroups = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([g]) => g);
  const topSet = new Set(topGroups);
  const hasOther = totals.size > topGroups.length;
  const stackKeys = hasOther ? [...topGroups, "Other"] : topGroups;

  const byX = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const key = topSet.has(r.group) ? r.group : "Other";
    const entry = byX.get(r.x) ?? {};
    entry[key] = (entry[key] ?? 0) + r.value;
    byX.set(r.x, entry);
  }
  const data: StackRow[] = [...byX.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([x, vals]) => ({ x, ...vals }));
  const colorFor = (k: string) => (k === "Other" ? "#94a3b8" : STACK_PALETTE[stackKeys.indexOf(k) % STACK_PALETTE.length]);
  return { data, stackKeys, colorFor };
}

function OverviewTab({ isAdmin }: { isAdmin: boolean }) {
  const [period, setPeriod] = useState<Period>(() => currentPeriod("MONTH"));
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const from = period.start.toISOString().slice(0, 10);
  const to = period.end.toISOString().slice(0, 10);

  // Non-admin only: their own personal-scope insights, embedded here per the
  // plan's nav table ("A personal-scope insight card embeds in their
  // Performance→Overview instead" of the full admin-only Insight Feed tab). The
  // insightfeed route runs resolveAnalyticsScope + generateInsights, which force
  // a non-admin's ownerIds to [self] — this can only ever be this rep's own
  // insights, never another rep's. Admin skips this fetch (they get the full
  // Insight Feed tab under Insights & Digest).
  const [personalInsights, setPersonalInsights] = useState<InsightRow[] | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/crm/analytics/overview?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useEffect(() => {
    if (isAdmin) return;
    setPersonalInsights(null);
    fetch(`/api/crm/analytics/insightfeed?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d) => setPersonalInsights(d.insights ?? []))
      .catch(() => setPersonalInsights([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, from, to]);

  const tp = data?.targetProgress ?? null;

  // Only the single scoped target's own pace/gap is available here (kpiBoard
  // doesn't fetch a per-rep target for every row in repRankings) — so the
  // recommended action reflects overall pace, not a per-rep breakdown.
  let action: string | undefined;
  if (tp?.targetRevenue != null && tp.paceExpected != null) {
    const behind = tp.wonRevenue < tp.paceExpected;
    action = behind
      ? `Behind pace by ${fmtInr(tp.paceExpected - tp.wonRevenue)} this ${period.type.toLowerCase()} — review the open pipeline`
      : `On pace — ${fmtInr(tp.wonRevenue)} won toward a ${fmtInr(tp.targetRevenue)} target`;
  }

  return (
    <AnalyticsCard
      title="Overview"
      description="Won revenue vs target, win rate, pipeline coverage, and sales velocity for the selected period"
      action={action}
      drillHref={dealsHref({ outcome: "open", from, to })}
    >
      <div className="mb-4">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {loading || !data ? (
        <div className="text-sm text-slate-400 py-8 text-center">Loading...</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-slate-50 rounded-lg p-4">
              <div className="text-sm text-slate-600">Leads this period</div>
              <div className="text-xl font-semibold mt-1">{data.dealsCreated}</div>
              <div className="text-xs text-slate-400 mt-1">New deals created</div>
            </div>

            <div className="bg-slate-50 rounded-lg p-4">
              <div className="text-sm text-slate-600">Won revenue vs target</div>
              <div className="text-xl font-semibold mt-1">{fmtInr(data.wonRevenue)}</div>
              {tp?.targetRevenue != null ? (
                <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                  <div>Target {fmtInr(tp.targetRevenue)} · pace {tp.paceExpected != null ? fmtInr(tp.paceExpected) : "—"}</div>
                  <div className={tp.gapToTarget != null && tp.gapToTarget > 0 ? "text-red-600" : "text-emerald-600"}>
                    {tp.gapToTarget != null
                      ? tp.gapToTarget > 0
                        ? `${fmtInr(tp.gapToTarget)} short of full target`
                        : `${fmtInr(Math.abs(tp.gapToTarget))} over full target`
                      : "—"}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-400 mt-1">No target set for this period</div>
              )}
            </div>

            <div className="bg-slate-50 rounded-lg p-4">
              <div className="text-sm text-slate-600">Win rate</div>
              <div className="text-xl font-semibold mt-1">{fmtPct(data.winRate.rate)}</div>
              <div className="text-xs text-slate-500 mt-1">
                {data.winRate.n} closed this period
                {data.benchmarks.trailingWinRate != null && ` · co. avg ${fmtPct(data.benchmarks.trailingWinRate)}`}
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-4">
              <div className="text-sm text-slate-600">Avg project value</div>
              <div className="text-xl font-semibold mt-1">{data.avgProjectValue != null ? fmtInr(data.avgProjectValue) : "—"}</div>
              {data.avgProjectValue == null && <div className="text-xs text-slate-400 mt-1">Not enough won deals yet</div>}
            </div>

            <div className="bg-slate-50 rounded-lg p-4">
              <div className="text-sm text-slate-600">Sales velocity</div>
              <div className="text-xl font-semibold mt-1">{data.salesVelocity != null ? `${fmtInr(data.salesVelocity)}/day` : "—"}</div>
              <div className="text-xs text-slate-400 mt-1">Expected new won revenue per day, at current pace</div>
            </div>
          </div>

          <div className="bg-slate-50 rounded-lg p-4">
            <div className="text-sm text-slate-600">Open pipeline coverage</div>
            {tp ? (
              <>
                <div className="text-xl font-semibold mt-1">
                  {fmtInr(tp.isPipelineWeighted ? tp.weightedPipelineValue ?? 0 : tp.openPipelineValue)}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {tp.isPipelineWeighted
                    ? "Weighted by each stage's win probability"
                    : "Unweighted — no funnel stage has a win-probability % set yet (Admin → Taxonomies)"}
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-400 mt-1">—</div>
            )}
          </div>

          {/* Non-admin's single Rep-quadrant point (Phase 3) — a small "where
              you sit" indicator, not the full comparative scatter admin gets
              under Quadrants & Territory (that route 403s a non-admin
              anyway; this data comes from /overview's own repQuadrantSelf,
              which the API never populates with any other rep's numbers). */}
          {!isAdmin && (
            <div className="bg-slate-50 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Where you sit</h3>
              {data.repQuadrantSelf ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-500">Your activity score</div>
                    <div className="text-lg font-semibold text-slate-900">{data.repQuadrantSelf.x}</div>
                    <div className="text-xs text-slate-400 mt-0.5">Company median: {data.repQuadrantSelf.xBenchmark.toFixed(0)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Your win rate</div>
                    <div className="text-lg font-semibold text-slate-900">{fmtPct(data.repQuadrantSelf.y)}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Company avg: {fmtPct(data.repQuadrantSelf.yBenchmark)}
                      {data.repQuadrantSelf.n < MIN_SAMPLE_SIZE && ` · low confidence (n=${data.repQuadrantSelf.n})`}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400">Not enough activity yet to show where you sit.</p>
              )}
            </div>
          )}

          {/* Non-admin personal insight card (Phase 5) — the top 1-2 of this
              rep's OWN scope-safe insights, the embedded stand-in for the
              admin-only Insight Feed tab. Data comes from /insightfeed, which
              force-scopes a non-admin to their own deals (see generateInsights /
              resolveAnalyticsScope), so it can never show another rep's signal. */}
          {!isAdmin && (
            <div className="bg-slate-50 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Your insights</h3>
              {personalInsights == null ? (
                <p className="text-xs text-slate-400">Loading…</p>
              ) : personalInsights.length === 0 ? (
                <p className="text-xs text-slate-400">No notable signals for you this period.</p>
              ) : (
                <div className="space-y-2">
                  {personalInsights.slice(0, 2).map((ins) => (
                    <div key={ins.id} className="bg-white border border-slate-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <SeverityPill severity={ins.severity} />
                        <span className="text-sm font-medium text-slate-900">{ins.title}</span>
                        {ins.n < MIN_SAMPLE_SIZE && <span className="text-xs text-amber-600">low confidence (n={ins.n})</span>}
                      </div>
                      <p className="text-xs text-slate-600">{ins.detail}</p>
                      <p className="text-xs text-slate-700 mt-1">
                        <span className="font-medium">Recommended:</span> {ins.recommendedAction}
                      </p>
                      {ins.drillHref && (
                        <Link href={ins.drillHref} className="text-xs text-wa-dark hover:underline font-medium mt-1 inline-block">
                          See the deals →
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {isAdmin && data.repRankings && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Rep rankings (won revenue)</h3>
              <DataTable
                headers={["Rep", "Won revenue", "Win rate", "Deals won"]}
                rows={data.repRankings.map((r) => [r.ownerName, fmtInr(r.wonRevenue), fmtPct(r.winRate), r.dealsWon])}
              />
            </div>
          )}
        </div>
      )}
    </AnalyticsCard>
  );
}

function IndividualTab({ rows, range, isAdmin }: { rows: SalesActivityRow[]; range: DateRange; isAdmin: boolean }) {
  const headers = ["Rep", "Leads", "Deals created", "Site visits", "Quotations sent", "Quoted value", "Deals won", "Won value", "Win rate", "Avg cycle days"];
  const dataRows = rows.map((r) => [r.ownerName, r.leadsCreated, r.dealsCreated, r.siteVisits, r.quotationsSentInclRevisions, r.quotedValue, r.dealsWon, r.wonValue, fmtPct(r.winRate), r.avgCycleDays ?? "—"]);

  const trailing = rows.filter((r) => r.winRate != null);
  const lowest = trailing.length > 0 ? [...trailing].sort((a, b) => (a.winRate ?? 0) - (b.winRate ?? 0))[0] : null;
  const action = lowest
    ? isAdmin
      ? `${lowest.ownerName} has the lowest win rate this period (${fmtPct(lowest.winRate)}) — check in on their pipeline`
      : `Your win rate this period is ${fmtPct(lowest.winRate)} — review stalled deals below`
    : "Not enough closed deals yet for a win-rate comparison";

  return (
    <AnalyticsCard title="Per-rep activity" action={action} drillHref={dealsHref({ from: range.from, to: range.to })}>
      <div className="flex items-center justify-end mb-3">
        <ExportButtons filename="individual-performance" headers={headers} rows={dataRows} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-600 border-b border-slate-200">{headers.map((h) => <th key={h} className="px-2 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ownerId} className="border-b border-slate-100 last:border-0">
                <td className="px-2 py-2 font-medium">
                  <Link href={`/crm/analytics/rep/${r.ownerId}?from=${range.from}&to=${range.to}`} className="text-wa-dark hover:underline">
                    {r.ownerName}
                  </Link>
                </td>
                <td className="px-2 py-2">{r.leadsCreated}</td>
                <td className="px-2 py-2">{r.dealsCreated}</td>
                <td className="px-2 py-2">{r.siteVisits}</td>
                <td className="px-2 py-2">{r.quotationsSentInclRevisions}</td>
                <td className="px-2 py-2">{fmtInr(r.quotedValue)}</td>
                <td className="px-2 py-2">{r.dealsWon}</td>
                <td className="px-2 py-2">{fmtInr(r.wonValue)}</td>
                <td className="px-2 py-2">{fmtPct(r.winRate)}</td>
                <td className="px-2 py-2">{r.avgCycleDays ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} className="px-2 py-6 text-center text-slate-400">No activity in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </AnalyticsCard>
  );
}

export function StageVelocityCard({ rows }: { rows: StageVelocityRow[] }) {
  const withData = rows.filter((r) => r.n > 0 && r.medianDays != null);
  const headers = ["Stage", "Median time", "Moves"];
  const dataRows = withData.map((r) => [r.stageName, fmtDays(r.medianDays), r.n]);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-base font-semibold text-slate-900 mb-1">Time to move between stages</h3>
      <p className="text-sm text-slate-600 mb-3">Median days spent in each stage before advancing to the next one</p>
      {withData.length === 0 ? (
        <p className="text-sm text-slate-400">No stage transitions in this range yet.</p>
      ) : (
        <>
          <HorizontalBarChart
            data={withData}
            dataKey="medianDays"
            labelKey="stageName"
            height={Math.max(80, withData.length * 40)}
            colorFor={() => "#fbbf24"}
            tooltipFormatter={(r) => `${fmtDays(r.medianDays)} median · ${r.n} move${r.n === 1 ? "" : "s"}`}
          />
          <div className="mt-3">
            <DataTable headers={headers} rows={dataRows} />
          </div>
        </>
      )}
      {rows.some((r) => r.n > 0 && r.medianDays == null) && (
        <p className="text-xs text-slate-400 mt-2">Some stages have moves but insufficient data for a median — not charted.</p>
      )}
    </div>
  );
}

function OverallTab({
  funnel,
  salesActivity,
  stageVelocity,
  range,
}: {
  funnel: AnalyticsResponse["funnel"];
  salesActivity: SalesActivityRow[];
  stageVelocity: StageVelocityRow[];
  range: DateRange;
}) {
  const teamTotals = salesActivity.reduce(
    (acc, r) => ({ dealsCreated: acc.dealsCreated + r.dealsCreated, dealsWon: acc.dealsWon + r.dealsWon, wonValue: acc.wonValue + r.wonValue, quotedValue: acc.quotedValue + r.quotedValue }),
    { dealsCreated: 0, dealsWon: 0, wonValue: 0, quotedValue: 0 },
  );
  // Per-rep "deals created" leaderboard — sorted by volume of deals created in
  // the range, so the most active reps read at the top (mirrors Zoho's rep
  // activity leaderboard). Reuses the same salesActivity rows the stat cards do.
  const repsByCreated = [...salesActivity].sort((a, b) => b.dealsCreated - a.dealsCreated);
  const createdWithData = repsByCreated.filter((r) => r.dealsCreated > 0);
  const createdHeaders = ["Rep", "Deals created", "Deals won", "Won value", "Quoted value"];
  const createdDataRows = repsByCreated.map((r) => [r.ownerName, r.dealsCreated, r.dealsWon, fmtInr(r.wonValue), fmtInr(r.quotedValue)]);
  const stagesWithDeals = funnel.stages.filter((s) => s.count > 0);
  const stageHeaders = ["Stage", "Deals", "Value"];
  const stageDataRows = stagesWithDeals.map((s) => [s.stageName, s.count, fmtInr(s.value)]);
  const busiestStage = stagesWithDeals.length > 0 ? [...stagesWithDeals].sort((a, b) => b.count - a.count)[0] : null;
  const topLossReason = funnel.lossReasons.length > 0 ? [...funnel.lossReasons].sort((a, b) => b.count - a.count)[0] : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-sm text-slate-600">Deals created</div><div className="text-xl font-semibold mt-1">{teamTotals.dealsCreated}</div></div>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-sm text-slate-600">Quoted value</div><div className="text-xl font-semibold mt-1">{fmtInr(teamTotals.quotedValue)}</div></div>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-sm text-slate-600">Deals won</div><div className="text-xl font-semibold mt-1">{teamTotals.dealsWon}</div></div>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-sm text-slate-600">Won value</div><div className="text-xl font-semibold mt-1">{fmtInr(teamTotals.wonValue)}</div></div>
      </div>
      <AnalyticsCard
        title="Deals created by rep"
        description="New deals each rep created in this range, ranked by volume — with what they went on to quote and win"
        drillHref={dealsHref({ from: range.from, to: range.to })}
      >
        <div className="flex items-center justify-end mb-3">
          <ExportButtons filename="deals-created-by-rep" headers={createdHeaders} rows={createdDataRows} />
        </div>
        {repsByCreated.length === 0 ? (
          <p className="text-sm text-slate-400">No rep activity in this range yet.</p>
        ) : (
          <>
            {createdWithData.length > 0 && (
              <HorizontalBarChart
                data={createdWithData}
                dataKey="dealsCreated"
                labelKey="ownerName"
                height={Math.max(80, createdWithData.length * 40)}
                colorFor={() => "#a78bfa"}
                tooltipFormatter={(r) => `${r.dealsCreated} created · ${r.dealsWon} won · ${fmtInr(r.wonValue)}`}
              />
            )}
            <div className="mt-3">
              <DataTable headers={createdHeaders} rows={createdDataRows} />
            </div>
          </>
        )}
      </AnalyticsCard>
      <AnalyticsCard
        title="Pipeline by stage (current snapshot)"
        action={busiestStage ? `${busiestStage.count} deal${busiestStage.count === 1 ? "" : "s"} currently sitting in ${busiestStage.stageName} — push them forward` : undefined}
        drillHref={busiestStage ? dealsHref({ stageId: busiestStage.stageId }) : undefined}
      >
        {stagesWithDeals.length === 0 ? (
          <p className="text-sm text-slate-400">No open deals in any stage right now.</p>
        ) : (
          <>
            <HorizontalBarChart
              data={stagesWithDeals}
              dataKey="count"
              labelKey="stageName"
              height={Math.max(80, stagesWithDeals.length * 40)}
              colorFor={(s) => s.stageColorHex ?? "#64748b"}
              tooltipFormatter={(s) => `${s.count} deal${s.count === 1 ? "" : "s"} · ${fmtInr(s.value)}`}
            />
            <div className="mt-3">
              <DataTable headers={stageHeaders} rows={stageDataRows} />
            </div>
          </>
        )}
      </AnalyticsCard>
      {funnel.lossReasons.length > 0 && (
        <AnalyticsCard
          title="Loss reasons"
          action={topLossReason ? `"${topLossReason.reasonName}" is the leading loss reason (${topLossReason.count}) — address it in coaching` : undefined}
          drillHref={dealsHref({ outcome: "LOST", from: range.from, to: range.to })}
        >
          <div className="space-y-1.5">
            {funnel.lossReasons.map((l) => (
              <div key={l.reasonName} className="flex items-center justify-between text-sm"><span className="text-slate-700">{l.reasonName}</span><span className="text-slate-500">{l.count}</span></div>
            ))}
          </div>
        </AnalyticsCard>
      )}
      <StageVelocityCard rows={stageVelocity} />
    </div>
  );
}

function ProductsTab({
  rows,
  cityHeatmap,
  movement,
  range,
}: {
  rows: ProductConversionRow[];
  cityHeatmap: ProductCityCell[];
  movement: ProductMovementRow[];
  range: DateRange;
}) {
  const sorted = [...rows].sort((a, b) => b.won - a.won);
  const headers = ["Product", "Enquiries", "Quoted", "Won", "Conversion rate"];
  const dataRows = sorted.map((r) => [r.productName, r.enquiries, r.quoted, r.won, fmtPct(r.conversionRate)]);
  const withWins = sorted.filter((r) => r.won > 0);
  const flagged = rows.find((r) => r.flagged);
  const topSeller = withWins.length > 0 ? withWins[0] : null;

  // Product-mix donut. Prefer deals-won share (true "best-selling") when any
  // product has been won; until then fall back to enquiry share so the chart
  // still shows real demand instead of "nothing to chart" (won is 0 for a long
  // while at this business's early pipeline stage).
  const anyProductWon = sorted.some((r) => r.won > 0);
  const productDonutRows = sorted
    .filter((r) => (anyProductWon ? r.won : r.enquiries) > 0)
    .sort((a, b) => (anyProductWon ? b.won - a.won : b.enquiries - a.enquiries));
  const productDonutTotal = productDonutRows.reduce((acc, r) => acc + (anyProductWon ? r.won : r.enquiries), 0);

  const revenueByMonth = stackedSeries(
    movement.filter((m) => m.wonValue > 0).map((m) => ({ x: m.month, group: m.productName, value: m.wonValue })),
    6,
  );

  const cityRows = [...cityHeatmap].sort((a, b) => (a.city === b.city ? b.wonValue - a.wonValue : a.city.localeCompare(b.city)));
  // Won value per city, stacked by product (top 6 products by revenue, rest
  // folded into Other) — the visual companion to the by-city table below.
  const cityByProduct = stackedSeries(
    cityHeatmap.filter((c) => c.wonValue > 0).map((c) => ({ x: c.city, group: c.productName, value: c.wonValue })),
    6,
  );
  const cityHeaders = ["City", "Product", "Enquiries", "Won value"];
  const cityDataRows = cityRows.map((r) => [r.city, r.productName, r.enquiries, r.wonValue]);
  const topCityCell = cityRows.length > 0 ? [...cityRows].sort((a, b) => b.wonValue - a.wonValue)[0] : null;

  // Flooring share-by-city donut. Same adaptive basis as the product donut:
  // won value when any city has closed revenue, else enquiry volume, so it
  // always renders real demand rather than a blank chart before wins land.
  const cityAgg = new Map<string, { enquiries: number; wonValue: number }>();
  for (const c of cityHeatmap) {
    const e = cityAgg.get(c.city) ?? { enquiries: 0, wonValue: 0 };
    e.enquiries += c.enquiries;
    e.wonValue += c.wonValue;
    cityAgg.set(c.city, e);
  }
  const anyCityWon = [...cityAgg.values()].some((v) => v.wonValue > 0);
  const cityDonutRows = [...cityAgg.entries()]
    .map(([city, v]) => ({ city, enquiries: v.enquiries, wonValue: v.wonValue }))
    .filter((r) => (anyCityWon ? r.wonValue : r.enquiries) > 0)
    .sort((a, b) => (anyCityWon ? b.wonValue - a.wonValue : b.enquiries - a.enquiries));
  const cityDonutTotal = cityDonutRows.reduce((acc, r) => acc + (anyCityWon ? r.wonValue : r.enquiries), 0);

  return (
    <div className="space-y-4">
      <AnalyticsCard
        title="Best-selling flooring products, by deals won"
        description={'Turf, acrylic, PVC and PPE-tile flooring only — fencing, lighting, nets and sub-base aren\'t a "product" line here'}
        action={
          flagged
            ? `${flagged.productName} has high enquiry volume but low conversion — investigate pricing/pitch`
            : topSeller
              ? `${topSeller.productName} is the best seller this period (${topSeller.won} won)`
              : undefined
        }
        drillHref={dealsHref({ outcome: "WON", from: range.from, to: range.to })}
      >
        <div className="flex items-center justify-end mb-1">
          <ExportButtons filename="best-selling-products" headers={headers} rows={dataRows} />
        </div>
        {sorted.length === 0 ? (
          <p className="text-sm text-slate-400">No product-level data in this range yet.</p>
        ) : productDonutRows.length === 0 ? (
          <p className="text-sm text-slate-400">No product enquiries or wins in this range yet.</p>
        ) : (
          <>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              {anyProductWon ? "Share of deals won, by product" : "Product demand share, by enquiries (no won deals in range yet)"}
            </h3>
            <DonutChart
              data={productDonutRows}
              dataKey={anyProductWon ? "won" : "enquiries"}
              labelKey="productName"
              colorFor={(_r, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]}
              tooltipFormatter={(r) =>
                `${r.productName}: ${anyProductWon ? `${r.won} won` : `${r.enquiries} enquir${r.enquiries === 1 ? "y" : "ies"}`} (${fmtPct(productDonutTotal > 0 ? (anyProductWon ? r.won : r.enquiries) / productDonutTotal : null)})`
              }
            />
          </>
        )}
        {sorted.length > 0 && (
          <div className="mt-3">
            <DataTable headers={headers} rows={dataRows} />
          </div>
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title="Revenue by product over time"
        description="Won value per month, stacked by product — the top 6 products by revenue in this range, remainder folded into Other"
        action={topSeller ? `${topSeller.productName} is the best seller this period (${topSeller.won} won)` : undefined}
        drillHref={dealsHref({ outcome: "WON", from: range.from, to: range.to })}
      >
        {revenueByMonth.data.length === 0 ? (
          <p className="text-sm text-slate-400">No won revenue in this range yet.</p>
        ) : (
          <StackedBarChart
            data={revenueByMonth.data}
            dataKey="x"
            stackKeys={revenueByMonth.stackKeys}
            height={Math.max(180, 220)}
            colorFor={revenueByMonth.colorFor}
            tooltipFormatter={(d) => revenueByMonth.stackKeys.map((k) => `${k}: ${fmtInr(Number(d[k] ?? 0))}`).join(" · ")}
          />
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title="Which flooring product sells best, by city"
        action={topCityCell ? `${topCityCell.productName} is strongest in ${topCityCell.city} (${fmtInr(topCityCell.wonValue)} won)` : undefined}
        drillHref={topCityCell ? dealsHref({ city: topCityCell.city, from: range.from, to: range.to }) : undefined}
      >
        <div className="flex items-center justify-end mb-3">
          <ExportButtons filename="flooring-by-city" headers={cityHeaders} rows={cityDataRows} />
        </div>
        {cityDonutRows.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              {anyCityWon ? "Won value share, by city" : "Flooring demand share, by city (by enquiries)"}
            </h3>
            <DonutChart
              data={cityDonutRows}
              dataKey={anyCityWon ? "wonValue" : "enquiries"}
              labelKey="city"
              colorFor={(_r, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]}
              tooltipFormatter={(r) =>
                `${r.city}: ${anyCityWon ? fmtInr(r.wonValue) : `${r.enquiries} enquir${r.enquiries === 1 ? "y" : "ies"}`} (${fmtPct(cityDonutTotal > 0 ? (anyCityWon ? r.wonValue : r.enquiries) / cityDonutTotal : null)})`
              }
            />
          </div>
        )}
        {cityByProduct.data.length > 0 && (
          <div className="mb-4">
            <StackedBarChart
              data={cityByProduct.data}
              dataKey="x"
              stackKeys={cityByProduct.stackKeys}
              height={Math.max(180, 220)}
              colorFor={cityByProduct.colorFor}
              tooltipFormatter={(d) => cityByProduct.stackKeys.map((k) => `${k}: ${fmtInr(Number(d[k] ?? 0))}`).join(" · ")}
            />
          </div>
        )}
        {cityRows.length === 0 ? (
          <p className="text-sm text-slate-400">No city-level flooring data in this range yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600 border-b border-slate-200">
                  {cityHeaders.map((h) => <th key={h} className="px-2 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {cityRows.map((r) => (
                  <tr key={`${r.city}|${r.productName}`} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-2 text-slate-700">{r.city}</td>
                    <td className="px-2 py-2 font-medium text-slate-900">{r.productName}</td>
                    <td className="px-2 py-2">{r.enquiries}</td>
                    <td className="px-2 py-2">{fmtInr(r.wonValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AnalyticsCard>
    </div>
  );
}

function PlatformsTab({ rows, range }: { rows: SourceRow[]; range: DateRange }) {
  const sorted = [...rows].sort((a, b) => b.wonValue - a.wonValue);
  const headers = ["Source", "Leads", "Qualified", "Quoted", "Won", "Won value", "Lead-to-won rate"];
  const dataRows = sorted.map((r) => [r.sourceName, r.leads, r.qualified, r.quoted, r.won, r.wonValue, fmtPct(r.leadToWonRate)]);
  const top = sorted.length > 0 ? sorted[0] : null;
  // Share-of-deals donut (Zoho's "Leads by Source" equivalent). Keyed on total
  // deals per source, NOT the `leads` column: leads come from the separate Lead
  // table, which is empty for this CRM-native business, so a leads-based donut
  // would always be blank. Deals is the real per-source volume.
  const dealDonutRows = sorted.filter((r) => r.deals > 0).sort((a, b) => b.deals - a.deals);
  const totalSourceDeals = dealDonutRows.reduce((acc, r) => acc + r.deals, 0);

  return (
    <AnalyticsCard
      title="Performance by platform / lead source"
      action={top ? `${top.sourceName} drives the most won value this period — double down there` : undefined}
      drillHref={dealsHref({ from: range.from, to: range.to })}
    >
      <div className="flex items-center justify-end mb-3">
        <ExportButtons filename="platform-performance" headers={headers} rows={dataRows} />
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-400">No source-level data in this range yet.</p>
      ) : (
        <>
          {dealDonutRows.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Deals by platform / source</h3>
              <DonutChart
                data={dealDonutRows}
                dataKey="deals"
                labelKey="sourceName"
                colorFor={(_r, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]}
                tooltipFormatter={(r) => `${r.sourceName}: ${r.deals} deal${r.deals === 1 ? "" : "s"} (${fmtPct(totalSourceDeals > 0 ? r.deals / totalSourceDeals : null)})`}
              />
            </div>
          )}
          <div className="mt-3">
            <DataTable headers={headers} rows={dataRows} />
          </div>
        </>
      )}
    </AnalyticsCard>
  );
}

function GeographyTab({ rows, range }: { rows: CityRow[]; range: DateRange }) {
  const sorted = [...rows].sort((a, b) => b.enquiries - a.enquiries);
  const headers = ["City", "Deals", "Quotations", "Won", "Won value", "Win rate", "Avg deal size", "Avg cycle"];
  const dataRows = sorted.map((r) => [r.city, r.enquiries, r.quotations, r.won, r.wonValue, fmtPct(r.winRate), r.avgDealSize ?? "—", fmtDays(r.avgCycleDays)]);
  const topCity = sorted.length > 0 ? sorted[0] : null;

  // Geography has no per-city time series (unlike products.ts's monthly
  // movement rows) — so "region contribution to revenue" renders as a
  // single 100%-stacked bar (one x-category, one segment per top city)
  // rather than a bar-per-month series.
  const revenueByCity = stackedSeries(
    sorted.filter((r) => r.wonValue > 0).map((r) => ({ x: "Won revenue", group: r.city, value: r.wonValue })),
    8,
  );

  // Share-of-deals donut: each city's slice is its portion of all deals in
  // range (only cities that actually contributed a deal get a slice).
  const dealDonutRows = sorted.filter((r) => r.enquiries > 0);
  const totalDeals = dealDonutRows.reduce((acc, r) => acc + r.enquiries, 0);

  return (
    <div className="space-y-4">
      <AnalyticsCard
        title="Deals by location"
        description="Every deal's site city, ranked by volume — where the pipeline is actually coming from"
        action={topCity ? `Focus outreach on your top city: ${topCity.city}` : undefined}
        drillHref={topCity ? dealsHref({ city: topCity.city, from: range.from, to: range.to }) : undefined}
      >
        <div className="flex items-center justify-end mb-1">
          <ExportButtons filename="deals-by-location" headers={headers} rows={dataRows} />
        </div>
        {dealDonutRows.length === 0 ? (
          <p className="text-sm text-slate-400">No location data in this range yet.</p>
        ) : (
          <DonutChart
            data={dealDonutRows}
            dataKey="enquiries"
            labelKey="city"
            colorFor={(_r, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]}
            tooltipFormatter={(r) => `${r.city}: ${r.enquiries} deal${r.enquiries === 1 ? "" : "s"} (${fmtPct(totalDeals > 0 ? r.enquiries / totalDeals : null)})`}
          />
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title="Revenue contribution by city"
        description="Share of won revenue in this range coming from each city — top 8, remainder folded into Other"
        action={topCity ? `Focus outreach on your top city: ${topCity.city}` : undefined}
        drillHref={topCity ? dealsHref({ city: topCity.city, from: range.from, to: range.to }) : undefined}
      >
        {revenueByCity.data.length === 0 ? (
          <p className="text-sm text-slate-400">No won revenue in this range yet.</p>
        ) : (
          <StackedBarChart
            data={revenueByCity.data}
            dataKey="x"
            stackKeys={revenueByCity.stackKeys}
            height={160}
            colorFor={revenueByCity.colorFor}
            tooltipFormatter={(d) => revenueByCity.stackKeys.map((k) => `${k}: ${fmtInr(Number(d[k] ?? 0))}`).join(" · ")}
          />
        )}
      </AnalyticsCard>

      {sorted.length > 0 && (
        <AnalyticsCard
          title="City breakdown"
          action={topCity ? `Focus outreach on your top city: ${topCity.city}` : undefined}
          drillHref={topCity ? dealsHref({ city: topCity.city, from: range.from, to: range.to }) : undefined}
        >
          <DataTable headers={headers} rows={dataRows} />
        </AnalyticsCard>
      )}
    </div>
  );
}

// --- Comparisons & Patterns group (Phase 2, admin-only) ---

function ComparatorsTab({
  repRows,
  dimensions,
  fy,
  range,
}: {
  repRows: RepComparisonRow[];
  dimensions: Record<Dimension, DimensionComparisonRow[]>;
  fy: { current: FyBenchmark; previous: FyBenchmark };
  range: DateRange;
}) {
  const [dimension, setDimension] = useState<Dimension>("region");
  const dimRows = [...dimensions[dimension]].sort((a, b) => b.enquiries - a.enquiries);
  const dimHeaders = ["Label", "Enquiries", "Won", "Won value", "Win rate"];
  const dimDataRows = dimRows.map((r) => [r.label, r.enquiries, r.won, fmtInr(r.wonValue), fmtPct(r.winRate)]);
  const topDim = dimRows.length > 0 ? dimRows[0] : null;
  // Only "region" rows carry a label the deals drill-down page can actually
  // filter on (dealsHref's city param) — sector/product/source group on
  // free-text names, not the taxonomy ids the drilldown contract needs, the
  // same limitation ProductsTab/GeographyTab already live with for products.
  const dimDrillHref =
    topDim && dimension === "region"
      ? dealsHref({ city: topDim.label, from: range.from, to: range.to })
      : dealsHref({ from: range.from, to: range.to });

  const repHeaders = ["Rep", "Won revenue", "Win rate", "Avg cycle", "Avg project value"];
  const repDataRows = repRows.map((r) => [
    r.ownerName,
    fmtInr(r.wonRevenue),
    fmtPct(r.winRate.rate),
    fmtDays(r.avgCycleDays.days),
    r.avgProjectValue != null ? fmtInr(r.avgProjectValue) : "—",
  ]);
  const topRep = repRows.length > 0 ? [...repRows].sort((a, b) => b.wonRevenue - a.wonRevenue)[0] : null;

  const sectorMix = stackedSeries(
    dimensions.sector.filter((r) => r.wonValue > 0).map((r) => ({ x: "Won revenue", group: r.label, value: r.wonValue })),
    8,
  );

  return (
    <div className="space-y-4">
      <AnalyticsCard
        title="Rep comparison"
        description="Won revenue, win rate, cycle time and average project value, side by side"
        action={topRep ? `${topRep.ownerName} leads on won revenue this period (${fmtInr(topRep.wonRevenue)})` : undefined}
        drillHref={dealsHref({ from: range.from, to: range.to })}
      >
        {repRows.length === 0 ? (
          <p className="text-sm text-slate-400">No rep activity in this range yet.</p>
        ) : (
          <DataTable headers={repHeaders} rows={repDataRows} />
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title="Compare by dimension"
        description="Region, sector, product or lead source — enquiries, wins and win rate side by side"
        action={topDim ? `${topDim.label} leads this dimension (${topDim.enquiries} enquiries, ${fmtPct(topDim.winRate)} win rate)` : undefined}
        drillHref={dimDrillHref}
      >
        <div className="mb-3">
          <select
            value={dimension}
            onChange={(e) => setDimension(e.target.value as Dimension)}
            className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
          >
            <option value="region">Region</option>
            <option value="sector">Sector</option>
            <option value="product">Product</option>
            <option value="source">Source</option>
          </select>
        </div>
        {dimRows.length === 0 ? (
          <p className="text-sm text-slate-400">No data for this dimension in this range yet.</p>
        ) : (
          <>
            <HorizontalBarChart
              data={dimRows}
              dataKey="enquiries"
              labelKey="label"
              height={Math.max(80, dimRows.length * 40)}
              colorFor={() => "#60a5fa"}
              tooltipFormatter={(r) => `${r.enquiries} enquiries · ${r.won} won · ${fmtInr(r.wonValue)} · ${fmtPct(r.winRate)}`}
            />
            <div className="mt-3">
              <DataTable headers={dimHeaders} rows={dimDataRows} />
            </div>
          </>
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title="Sector mix (revenue)"
        description="Share of won revenue by customer profile — top 8, remainder folded into Other"
        drillHref={dealsHref({ from: range.from, to: range.to })}
      >
        {sectorMix.data.length === 0 ? (
          <p className="text-sm text-slate-400">No won revenue in this range yet.</p>
        ) : (
          <StackedBarChart
            data={sectorMix.data}
            dataKey="x"
            stackKeys={sectorMix.stackKeys}
            height={160}
            colorFor={sectorMix.colorFor}
            tooltipFormatter={(d) => sectorMix.stackKeys.map((k) => `${k}: ${fmtInr(Number(d[k] ?? 0))}`).join(" · ")}
          />
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title="FY vs FY"
        description="Company-wide trailing benchmarks, this fiscal year vs the previous one"
        drillHref={dealsHref({ from: range.from, to: range.to })}
      >
        <div className="grid grid-cols-2 gap-3">
          {[fy.previous, fy.current].map((b) => (
            <div key={b.label} className="bg-slate-50 rounded-lg p-4">
              <div className="text-sm font-semibold text-slate-700">{b.label}</div>
              <div className="text-xs text-slate-500 mt-2 space-y-1">
                <div>Win rate: {fmtPct(b.trailingWinRate)}</div>
                <div>Avg cycle: {fmtDays(b.avgCycleDays)}</div>
                <div>Avg project value: {b.avgProjectValue != null ? fmtInr(b.avgProjectValue) : "—"}</div>
              </div>
            </div>
          ))}
        </div>
      </AnalyticsCard>
    </div>
  );
}

function FunnelPatternsTab({
  funnel,
  range,
}: {
  funnel: { segments: SegmentFunnelRow[]; sourcePaths: SourcePathRow[]; valueByStage: ValueFunnelRow[] };
  range: DateRange;
}) {
  const segmentRows = [...funnel.segments].sort((a, b) => a.sortOrder - b.sortOrder || a.profileName.localeCompare(b.profileName));
  const segmentHeaders = ["Stage", "Segment", "Deals", "Value"];
  const segmentDataRows = segmentRows.map((r) => [r.stageName, r.profileName, r.count, fmtInr(r.value)]);

  const sourceRows = [...funnel.sourcePaths].sort((a, b) => a.sortOrder - b.sortOrder || a.sourceName.localeCompare(b.sourceName));
  const sourceHeaders = ["Stage", "Source", "Deals", "Value"];
  const sourceDataRows = sourceRows.map((r) => [r.stageName, r.sourceName, r.count, fmtInr(r.value)]);

  const valueRows = [...funnel.valueByStage].sort((a, b) => a.sortOrder - b.sortOrder).filter((r) => r.count > 0);
  const valueHeaders = ["Stage", "Deals", "Value"];
  const valueDataRows = valueRows.map((r) => [r.stageName, r.count, fmtInr(r.value)]);
  const biggestStage = valueRows.length > 0 ? [...valueRows].sort((a, b) => b.value - a.value)[0] : null;

  return (
    <div className="space-y-4">
      <AnalyticsCard
        title="Value at each stage"
        description="Current pipeline value sitting in each stage right now"
        action={biggestStage ? `${fmtInr(biggestStage.value)} sitting in ${biggestStage.stageName} right now` : undefined}
        drillHref={biggestStage ? dealsHref({ stageId: biggestStage.stageId }) : dealsHref({ from: range.from, to: range.to })}
      >
        {valueRows.length === 0 ? (
          <p className="text-sm text-slate-400">No open pipeline value right now.</p>
        ) : (
          <>
            <HorizontalBarChart
              data={valueRows}
              dataKey="value"
              labelKey="stageName"
              height={Math.max(80, valueRows.length * 40)}
              colorFor={() => "#fbbf24"}
              tooltipFormatter={(r) => `${fmtInr(r.value)} · ${r.count} deal${r.count === 1 ? "" : "s"}`}
            />
            <div className="mt-3">
              <DataTable headers={valueHeaders} rows={valueDataRows} />
            </div>
          </>
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title="Funnel by customer segment"
        description="Where each customer profile's open deals currently sit in the pipeline"
        drillHref={dealsHref({ from: range.from, to: range.to })}
      >
        {segmentRows.length === 0 ? (
          <p className="text-sm text-slate-400">No open deals to show yet.</p>
        ) : (
          <DataTable headers={segmentHeaders} rows={segmentDataRows} />
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title="Funnel by source path"
        description="Where each lead source's open deals currently sit in the pipeline"
        drillHref={dealsHref({ from: range.from, to: range.to })}
      >
        {sourceRows.length === 0 ? (
          <p className="text-sm text-slate-400">No open deals to show yet.</p>
        ) : (
          <DataTable headers={sourceHeaders} rows={sourceDataRows} />
        )}
      </AnalyticsCard>
    </div>
  );
}

function CohortsTab({
  cohorts,
  range,
}: {
  cohorts: { enquiry: EnquiryCohortRow[]; repeatPurchase: RepeatPurchaseRow[] };
  range: DateRange;
}) {
  const months = [...cohorts.enquiry].sort((a, b) => a.month.localeCompare(b.month));
  // Stage columns assumed consistent across every cohort month — every
  // month is built from the same active-FunnelStage + synthetic WON bucket
  // set (see cohorts.ts's enquiryCohort), so the first row's stage set is
  // representative; each cell below still looks up by stageId rather than
  // assuming positional alignment.
  const stageColumns = months[0]?.stages.map((s) => ({ stageId: s.stageId, stageName: s.stageName })) ?? [];

  const repeatRows = [...cohorts.repeatPurchase].sort((a, b) => a.pairIndex - b.pairIndex);

  return (
    <div className="space-y-4">
      <AnalyticsCard
        title="Enquiry cohorts"
        description={`Of what came in each creation-month, % reaching each stage and the median days to get there — months with fewer than ${MIN_SAMPLE_SIZE} enquiries are marked insufficient data`}
        drillHref={dealsHref({ from: range.from, to: range.to })}
      >
        {months.length === 0 ? (
          <p className="text-sm text-slate-400">No enquiry data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600 border-b border-slate-200">
                  <th className="px-2 py-2 font-semibold whitespace-nowrap">Month</th>
                  <th className="px-2 py-2 font-semibold whitespace-nowrap">Cohort size</th>
                  {stageColumns.map((s) => (
                    <th key={s.stageId} className="px-2 py-2 font-semibold whitespace-nowrap">{s.stageName}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-2 font-medium text-slate-900 whitespace-nowrap">{m.month}</td>
                    <td className="px-2 py-2">{m.cohortSize}</td>
                    {stageColumns.map((sc) => {
                      const cell = m.stages.find((s) => s.stageId === sc.stageId);
                      return (
                        <td key={sc.stageId} className="px-2 py-2 whitespace-nowrap">
                          {m.insufficientData
                            ? "insufficient data"
                            : cell && cell.reachedPct != null
                              ? `${fmtPct(cell.reachedPct)} · ${fmtDays(cell.medianDaysToReach)}`
                              : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title="Repeat purchase cohort"
        description="Time between a repeat account's consecutive won deals, by purchase number"
        drillHref={dealsHref({ outcome: "WON", from: range.from, to: range.to })}
      >
        {repeatRows.length === 0 ? (
          <p className="text-sm text-slate-400">No repeat-purchase pairs in this range yet.</p>
        ) : (
          <DataTable
            headers={["Purchase pair", "Median gap", "P90 gap", "Pairs (n)"]}
            rows={repeatRows.map((r) => [
              r.label,
              r.medianDays != null ? fmtDays(r.medianDays) : "insufficient data",
              r.p90Days != null ? fmtDays(r.p90Days) : "insufficient data",
              r.n,
            ])}
          />
        )}
      </AnalyticsCard>
    </div>
  );
}

// --- Quadrants & Territory group (Phase 3, admin-only) ---

// One card per quadrant (Lead Source/Product/Rep/Region) — all four share
// the same x/y/n shape and the same y axis (win rate), only the x
// dimension's meaning and formatting differ per quadrants.ts's four
// functions, so this is one component parameterized by xFmt rather than
// four near-duplicate bodies.
function QuadrantCard({
  title,
  description,
  result,
  xFmt,
  color,
  drillHref,
}: {
  title: string;
  description: string;
  result: QuadrantResultRow;
  xFmt: (n: number) => string;
  color: string;
  drillHref?: string;
}) {
  const lowConfidenceIds = new Set(result.lowConfidenceIds);
  return (
    <AnalyticsCard title={title} description={description} drillHref={drillHref}>
      {result.points.length === 0 ? (
        <p className="text-sm text-slate-400">No data in this range yet.</p>
      ) : (
        <QuadrantScatter
          data={result.points}
          xKey="x"
          yKey="y"
          labelKey="id"
          height={280}
          xBenchmark={result.xBenchmark}
          yBenchmark={result.yBenchmark}
          colorFor={() => color}
          lowConfidenceIds={lowConfidenceIds}
          tooltipFormatter={(d) =>
            `${d.label}: ${xFmt(d.x)} · ${fmtPct(d.y)}` + (lowConfidenceIds.has(d.id) ? ` · n=${d.n}, low confidence` : ` · n=${d.n}`)
          }
        />
      )}
    </AnalyticsCard>
  );
}

function FourQuadrantsTab({ data, range }: { data: QuadrantsResponse; range: DateRange }) {
  return (
    <div className="space-y-4">
      <QuadrantCard
        title="Lead source: volume × win rate"
        description="Enquiry volume vs win rate per lead source, split by trailing company win rate and median enquiry volume"
        result={data.leadSource}
        xFmt={(n) => `${n} enquir${n === 1 ? "y" : "ies"}`}
        color="#25D366"
        drillHref={dealsHref({ from: range.from, to: range.to })}
      />
      <QuadrantCard
        title="Product: enquiry growth × win rate"
        description="Enquiry growth vs the prior period of equal length, against win rate — explicitly not margin"
        result={data.product}
        xFmt={(n) => `${n.toFixed(0)}% growth`}
        color="#60a5fa"
        drillHref={dealsHref({ outcome: "WON", from: range.from, to: range.to })}
      />
      <QuadrantCard
        title="Rep: activity × conversion"
        description="Deals created + site visits + samples sent, against win rate"
        result={data.rep}
        xFmt={(n) => `${n} activity`}
        color="#fbbf24"
        drillHref={dealsHref({ from: range.from, to: range.to })}
      />
      <QuadrantCard
        title="Region: volume × win rate"
        description="Enquiry volume vs win rate, by city"
        result={data.region}
        xFmt={(n) => `${n} enquir${n === 1 ? "y" : "ies"}`}
        color="#73caf0"
        drillHref={dealsHref({ from: range.from, to: range.to })}
      />
    </div>
  );
}

function TerritoryTab({ rows, range }: { rows: TerritoryBubbleRow[]; range: DateRange }) {
  const sorted = [...rows].sort((a, b) => b.enquiryVolume - a.enquiryVolume);
  // Cities below MIN_SAMPLE_SIZE closed deals have a null avgDealSize/winRate
  // (territory.ts's own gate) — a numeric x/y axis can't plot null, so those
  // cities are chart-excluded here but still listed (as "insufficient data")
  // in the DataTable fallback below, same "suppressed cell, not a dropped
  // row" discipline as everywhere else MIN_SAMPLE_SIZE applies.
  const chartable = sorted.filter(
    (r): r is TerritoryBubbleRow & { avgDealSize: number; winRate: number } => r.avgDealSize != null && r.winRate != null,
  );
  const headers = ["City", "Avg deal size", "Win rate", "Enquiry volume", "n"];
  const dataRows = sorted.map((r) => [
    r.city,
    r.avgDealSize != null ? fmtInr(r.avgDealSize) : "insufficient data",
    r.winRate != null ? fmtPct(r.winRate) : "insufficient data",
    r.enquiryVolume,
    r.n,
  ]);
  const topCity = sorted.length > 0 ? sorted[0] : null;

  return (
    <div className="space-y-4">
      <AnalyticsCard
        title="Territory: avg deal size × win rate, sized by enquiry volume"
        description="Each bubble is a city — avg deal size vs win rate, bubble size is enquiry volume. Cities with too few closed deals for a reliable average/rate aren't charted (see the table below)."
        action={topCity ? `${topCity.city} has the most enquiry volume this period (${topCity.enquiryVolume})` : undefined}
        drillHref={topCity ? dealsHref({ city: topCity.city, from: range.from, to: range.to }) : undefined}
      >
        {chartable.length === 0 ? (
          <p className="text-sm text-slate-400">No city has enough closed deals yet for a reliable bubble chart — see the table below.</p>
        ) : (
          <BubbleChart
            data={chartable}
            xKey="avgDealSize"
            yKey="winRate"
            zKey="enquiryVolume"
            labelKey="city"
            height={280}
            colorFor={() => "#a78bfa"}
            tooltipFormatter={(r) => `${r.city}: ${fmtInr(r.avgDealSize)} avg · ${fmtPct(r.winRate)} win rate · ${r.enquiryVolume} enquiries (n=${r.n})`}
          />
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title="City breakdown"
        drillHref={topCity ? dealsHref({ city: topCity.city, from: range.from, to: range.to }) : undefined}
      >
        <div className="flex items-center justify-end mb-3">
          <ExportButtons filename="territory" headers={headers} rows={dataRows} />
        </div>
        {sorted.length === 0 ? <p className="text-sm text-slate-400">No city data in this range yet.</p> : <DataTable headers={headers} rows={dataRows} />}
      </AnalyticsCard>
    </div>
  );
}

// --- Industry Insights group (Phase 4, admin-only) ---

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function SeasonalityTab({ data }: { data: SeasonalityResult }) {
  const headers = ["Sport", "Month", "Enquiries", "Won", "Won value"];
  const dataRows = data.rows.map((r) => [r.sportName, MONTH_NAMES[r.month - 1], r.enquiries, r.won, fmtInr(r.wonValue)]);
  const sports = data.seasonalIndex ? Object.keys(data.seasonalIndex).sort() : [];
  const peak = data.rows.length > 0 ? [...data.rows].sort((a, b) => b.enquiries - a.enquiries)[0] : null;

  return (
    <AnalyticsCard
      title="Seasonal demand by sport"
      description="Enquiries and wins per sport, folded across every year of history into a single 12-month shape — the recurring pattern, not any one year's numbers. No drill-to-deals here: a month bucket spans multiple years, which isn't a filter the deals drill-down page can express."
      action={
        peak
          ? `${peak.sportName} peaks in ${MONTH_NAMES[peak.month - 1]} (${peak.enquiries} enquir${peak.enquiries === 1 ? "y" : "ies"}, folded across ${data.distinctYears.length} year${data.distinctYears.length === 1 ? "" : "s"})`
          : undefined
      }
    >
      {data.seasonalIndex == null ? (
        <p className="text-sm text-slate-400 mb-3">
          Learning — needs more history. A seasonal index needs at least 2 different years of enquiry data
          {data.distinctYears.length > 0 ? ` (currently have ${data.distinctYears.length}: ${data.distinctYears.join(", ")}).` : "."}
        </p>
      ) : (
        <div className="space-y-3 mb-4">
          {sports.map((sportName) => {
            const idx = data.seasonalIndex![sportName];
            const max = Math.max(1, ...idx);
            return (
              <div key={sportName}>
                <div className="text-sm font-medium text-slate-700 mb-1">{sportName}</div>
                <div className="flex items-end gap-1 h-12">
                  {idx.map((v, i) => (
                    <div key={i} className="flex-1 h-full flex items-end" title={`${MONTH_NAMES[i]}: ${v.toFixed(2)}x average`}>
                      <div className="w-full bg-wa-green/70 rounded-t" style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
                    </div>
                  ))}
                </div>
                <div className="flex gap-1 mt-0.5">
                  {MONTH_NAMES.map((m) => (
                    <div key={m} className="flex-1 text-[10px] text-slate-400 text-center">{m[0]}</div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {data.rows.length === 0 ? (
        <p className="text-sm text-slate-400">No line-item data yet.</p>
      ) : (
        <DataTable headers={headers} rows={dataRows} />
      )}
    </AnalyticsCard>
  );
}

function ReferralPartnersTab({ data }: { data: ReferralScoreboard }) {
  const headers = ["Referral source", "Enquiries", "Won", "Won value", "Win rate"];
  const dataRows = data.rows.map((r) => [r.sourceDetail, r.enquiries, r.won, fmtInr(r.wonValue), fmtPct(r.winRate)]);
  const top = data.rows.find((r) => r.sourceDetail !== "(unspecified)");

  return (
    <AnalyticsCard
      title="Referral partner scoreboard"
      description="Grouped on the raw sourceDetail text exactly as entered, not cleaned up — so fragmentation is visible rather than hidden. No drill-to-deals here: sourceDetail isn't a field the deals drill-down page can filter on."
      action={top ? `${top.sourceDetail} leads referral volume (${top.enquiries} enquiries, ${fmtPct(top.winRate)} win rate)` : undefined}
    >
      {data.likelyFragmented && (
        <div className="mb-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          {data.distinctValueCount} distinct referral values recorded — likely fragmented (the same partner may be typed differently deal to deal) rather than genuinely that many distinct partners.
        </div>
      )}
      <div className="flex items-center justify-end mb-3">
        <ExportButtons filename="referral-scoreboard" headers={headers} rows={dataRows} />
      </div>
      {data.rows.length === 0 ? <p className="text-sm text-slate-400">No source-detail data yet.</p> : <DataTable headers={headers} rows={dataRows} />}
    </AnalyticsCard>
  );
}

function RequirementFingerprintTab({ rows, range }: { rows: ProfileFingerprintRow[]; range: DateRange }) {
  const sorted = [...rows].sort((a, b) => b.dealCount - a.dealCount);
  const headers = ["Segment", "Deals", "Dominant sports", "Dominant products", "Avg area (sq ft)", "Avg won value", "Dominant source"];
  const dataRows = sorted.map((r) => [
    r.profileName,
    r.dealCount,
    r.dominantSports.join(", ") || "—",
    r.dominantProducts.join(", ") || "—",
    r.avgAreaSqFt != null ? r.avgAreaSqFt.toFixed(0) : "insufficient data",
    r.avgWonValue != null ? fmtInr(r.avgWonValue) : "insufficient data",
    r.dominantSource,
  ]);
  const top = sorted.length > 0 ? sorted[0] : null;

  return (
    <AnalyticsCard
      title="Requirement fingerprint by customer segment"
      description="What each customer profile typically wants: dominant sport(s)/product mix, typical site area, typical deal value, and dominant lead source"
      action={top ? `${top.profileName} is your biggest segment (${top.dealCount} deals)` : undefined}
      drillHref={top?.customerProfileId ? dealsHref({ customerProfileId: top.customerProfileId, from: range.from, to: range.to }) : undefined}
    >
      <div className="flex items-center justify-end mb-3">
        <ExportButtons filename="requirement-fingerprint" headers={headers} rows={dataRows} />
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-400">No segment data in this range yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600 border-b border-slate-200">
                {headers.map((h) => <th key={h} className="px-2 py-2 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.profileName} className="border-b border-slate-100 last:border-0">
                  <td className="px-2 py-2 font-medium text-slate-900 whitespace-nowrap">
                    {r.customerProfileId ? (
                      <Link href={dealsHref({ customerProfileId: r.customerProfileId, from: range.from, to: range.to })} className="text-wa-dark hover:underline">
                        {r.profileName}
                      </Link>
                    ) : (
                      r.profileName
                    )}
                  </td>
                  <td className="px-2 py-2">{r.dealCount}</td>
                  <td className="px-2 py-2">{r.dominantSports.join(", ") || "—"}</td>
                  <td className="px-2 py-2">{r.dominantProducts.join(", ") || "—"}</td>
                  <td className="px-2 py-2">{r.avgAreaSqFt != null ? r.avgAreaSqFt.toFixed(0) : "insufficient data"}</td>
                  <td className="px-2 py-2">{r.avgWonValue != null ? fmtInr(r.avgWonValue) : "insufficient data"}</td>
                  <td className="px-2 py-2">{r.dominantSource}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsCard>
  );
}

function WinLossSegmentTab({ winLoss, range }: { winLoss: Record<WinLossDimension, WinLossSegmentRow[]>; range: DateRange }) {
  const [dimension, setDimension] = useState<WinLossDimension>("region");
  const rows = [...winLoss[dimension]].sort((a, b) => b.lostCount - a.lostCount || b.wonCount - a.wonCount);
  const headers = ["Segment", "Loss reason", "Won", "Lost"];
  const dataRows = rows.map((r) => [r.segmentLabel, r.reasonName, r.wonCount, r.lostCount]);
  const top = rows.length > 0 ? rows[0] : null;

  // Only region rows carry a label the deals drill-down page can filter on
  // directly (city); sector rows carry a resolved customerProfileId
  // (stitched on by /api/crm/analytics/insights); product rows are a
  // free-text product name with no matching taxonomy id available here —
  // same limitation ComparatorsTab already lives with for its own dimension
  // picker (only "region" gets a specific field, the rest fall back).
  const drillHref = top
    ? dimension === "region"
      ? dealsHref({ city: top.segmentLabel, outcome: "LOST", from: range.from, to: range.to })
      : dimension === "sector" && top.customerProfileId
        ? dealsHref({ customerProfileId: top.customerProfileId, outcome: "LOST", from: range.from, to: range.to })
        : dealsHref({ outcome: "LOST", from: range.from, to: range.to })
    : undefined;

  return (
    <AnalyticsCard
      title="Win/loss by segment"
      description="The existing loss-reason taxonomy, cross-cut by one dimension at a time — not a full 3-way matrix, which at this business's volume would mostly produce suppressed single-digit cells"
      action={top ? `"${top.reasonName}" is the leading loss reason for ${top.segmentLabel} (${top.lostCount} lost)` : undefined}
      drillHref={drillHref}
    >
      <div className="mb-3">
        <select
          value={dimension}
          onChange={(e) => setDimension(e.target.value as WinLossDimension)}
          className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
        >
          <option value="sector">Sector</option>
          <option value="region">Region</option>
          <option value="product">Product</option>
        </select>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No lost deals with a reason recorded for this dimension yet.</p>
      ) : (
        <DataTable headers={headers} rows={dataRows} />
      )}
    </AnalyticsCard>
  );
}

function ExecutionPipelineTab({ data, range }: { data: ExecutionSummary; range: DateRange }) {
  return (
    <AnalyticsCard
      title="Execution / delivery pipeline"
      description="Post-won delivery tracking — backlog, delivery time, and booked-vs-delivered revenue. Still all-zero/all-null on real data today: nothing sets a deal's execution status yet except the new control on the Deal Detail page."
      drillHref={dealsHref({ outcome: "WON", from: range.from, to: range.to })}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-50 rounded-lg p-4">
          <div className="text-sm text-slate-600">Backlog</div>
          <div className="text-xl font-semibold mt-1">{fmtInr(data.backlogValue)}</div>
          <div className="text-xs text-slate-500 mt-1">{data.backlogCount} deal{data.backlogCount === 1 ? "" : "s"} not yet delivered</div>
        </div>
        <div className="bg-slate-50 rounded-lg p-4">
          <div className="text-sm text-slate-600">Delivery time</div>
          <div className="text-xl font-semibold mt-1">{fmtDays(data.deliveryTime.medianDays)}</div>
          <div className="text-xs text-slate-500 mt-1">
            {data.deliveryTime.n > 0 ? `median · p90 ${fmtDays(data.deliveryTime.p90Days)} · n=${data.deliveryTime.n}` : "No completed deliveries yet"}
          </div>
        </div>
        <div className="bg-slate-50 rounded-lg p-4">
          <div className="text-sm text-slate-600">Booked revenue</div>
          <div className="text-xl font-semibold mt-1">{fmtInr(data.bookedRevenue)}</div>
          <div className="text-xs text-slate-400 mt-1">Won in this range</div>
        </div>
        <div className="bg-slate-50 rounded-lg p-4">
          <div className="text-sm text-slate-600">Delivered revenue</div>
          <div className="text-xl font-semibold mt-1">{fmtInr(data.deliveredRevenue)}</div>
          <div className="text-xs text-slate-400 mt-1">Won and delivered in this range</div>
        </div>
      </div>
    </AnalyticsCard>
  );
}
