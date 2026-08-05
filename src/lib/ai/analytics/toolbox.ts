// Feature 2 (AI analytics reports) — the tool layer. Every tool here wraps ONE
// real analytics function (src/lib/analytics/*) and returns its JSON unchanged,
// so the model can only ever report numbers a real DB query produced — it never
// computes or invents a figure itself (see tools.ts's own comment on why the
// analytics feature uses the manual tool loop). Each handler resolves the
// model-supplied period into a concrete {from,to}, forces dealChannel:"crm",
// and applies the caller's owner scope, so a non-admin can never widen past
// their own deals no matter what the model asks for.
import { prisma } from "@/lib/prisma";
import type { AiTool } from "@/lib/ai/tools";
import type { Role } from "@/lib/rbac";
import type { AnalyticsScope } from "@/lib/analytics/scope";
import type { AnalyticsFilter } from "@/lib/analytics/types";
import type { TargetScope, TargetPeriod } from "@/lib/analytics/targets";
import type { DealsDrilldownFilter } from "@/lib/analytics/dealsDrilldown";
import { allTimePeriod, monthPeriod, currentPeriod } from "@/lib/analytics/periodPresets";
import { startOfWeekIST, endOfDayIST } from "@/lib/time";
import { salesActivity } from "@/lib/analytics/salesActivity";
import { repComparison } from "@/lib/analytics/comparators";
import { productAnalytics } from "@/lib/analytics/products";
import { geography } from "@/lib/analytics/geography";
import { sourceAnalytics } from "@/lib/analytics/sources";
import { funnelSnapshot } from "@/lib/analytics/funnel";
import { stageVelocity } from "@/lib/analytics/timelines";
import { getKpiBoard } from "@/lib/analytics/kpiBoard";
import { getTargetProgress } from "@/lib/analytics/targets";
import { getInvoiceAnalytics } from "@/lib/analytics/invoices";
import { winLossBySegment } from "@/lib/analytics/winLossSegment";
import { seasonality } from "@/lib/analytics/seasonality";
import { getDealsDrilldown } from "@/lib/analytics/dealsDrilldown";

// ── Period handling ─────────────────────────────────────────────────────────
// The route body carries an optional default period; each tool may also name
// its own. Presets align to this business's Apr-Mar fiscal year via
// periodPresets.ts so target-row lookups (keyed on an exact boundary) match.
export type PeriodPreset =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "this_fy"
  | "all_time";
export type PeriodInput = PeriodPreset | { from: string; to: string };

const PRESETS: PeriodPreset[] = [
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "this_fy",
  "all_time",
];

function parseStart(raw: string): Date | null {
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}
function parseEnd(raw: string): Date | null {
  const d = new Date(raw + "T23:59:59.999");
  return Number.isNaN(d.getTime()) ? null : d;
}

function presetRange(preset: PeriodPreset): { from: Date; to: Date } {
  const now = new Date();
  switch (preset) {
    case "this_week": {
      const from = startOfWeekIST(now);
      const to = endOfDayIST(new Date(from.getTime() + 6 * 86_400_000));
      return { from, to };
    }
    case "last_week": {
      const from = new Date(startOfWeekIST(now).getTime() - 7 * 86_400_000);
      const to = endOfDayIST(new Date(from.getTime() + 6 * 86_400_000));
      return { from, to };
    }
    case "this_month": {
      const p = monthPeriod(now.getFullYear(), now.getMonth());
      return { from: p.start, to: p.end };
    }
    case "last_month": {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const p = monthPeriod(prev.getFullYear(), prev.getMonth());
      return { from: p.start, to: p.end };
    }
    case "this_quarter": {
      const p = currentPeriod("QUARTER");
      return { from: p.start, to: p.end };
    }
    case "this_fy": {
      const p = currentPeriod("FY");
      return { from: p.start, to: p.end };
    }
    case "all_time":
    default: {
      const p = allTimePeriod();
      return { from: p.start, to: p.end };
    }
  }
}

// Coerce an untrusted value (request body or model tool input) into a
// PeriodInput, or undefined if it isn't one. Kept here so the route validates
// the body's period against the exact same rules the tools accept.
export function coercePeriodInput(raw: unknown): PeriodInput | undefined {
  if (typeof raw === "string" && (PRESETS as string[]).includes(raw)) return raw as PeriodPreset;
  if (raw && typeof raw === "object") {
    const o = raw as { from?: unknown; to?: unknown };
    if (typeof o.from === "string" && typeof o.to === "string") return { from: o.from, to: o.to };
  }
  return undefined;
}

export function resolvePeriod(input: PeriodInput | undefined | null, fallback: PeriodInput = "all_time"): { from: Date; to: Date } {
  const chosen = input ?? fallback;
  if (typeof chosen === "string") return presetRange(chosen);
  const from = parseStart(chosen.from);
  const to = parseEnd(chosen.to);
  if (from && to) return { from, to };
  // Malformed explicit range → fall back rather than crash the tool call.
  return typeof fallback === "string" ? presetRange(fallback) : presetRange("all_time");
}

// The period the model chose for a tool call: an explicit customRange wins over
// a named preset; both are optional (falls back to the report default).
function pickPeriod(input: Record<string, unknown>): PeriodInput | undefined {
  const cr = input?.customRange;
  if (cr && typeof cr === "object") {
    const o = cr as { from?: unknown; to?: unknown };
    if (typeof o.from === "string" && typeof o.to === "string") return { from: o.from, to: o.to };
  }
  return typeof input?.period === "string" ? coercePeriodInput(input.period) : undefined;
}

// Same span → periodType inference kpiBoard.ts uses: a caller's date range
// isn't always a calendar boundary, so the Target row's type is inferred.
function inferPeriodType(from: Date, to: Date): "MONTH" | "QUARTER" | "FY" {
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days <= 31) return "MONTH";
  if (days <= 92) return "QUARTER";
  return "FY";
}

// ── Name → id resolution ────────────────────────────────────────────────────
// The model speaks in names ("Arjun", "Cricket"); the analytics functions take
// ids. Resolve here, and hard-force owner scope: a non-admin is ALWAYS pinned
// to their own ownerIds regardless of any repName the model passes.
async function resolveOwnerIds(scope: AnalyticsScope, repName?: unknown): Promise<{ ownerIds?: string[]; error?: string }> {
  if (!scope.companyWide) return { ownerIds: scope.ownerIds };
  const name = typeof repName === "string" ? repName.trim() : "";
  if (!name) return { ownerIds: undefined };
  const users = await prisma.user.findMany({
    where: { deletedAt: null, name: { contains: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (users.length === 0) return { error: `No sales rep found matching "${name}".` };
  return { ownerIds: users.map((u) => u.id) };
}

async function resolveSportIds(sportName?: unknown): Promise<{ sportIds?: string[]; error?: string }> {
  const name = typeof sportName === "string" ? sportName.trim() : "";
  if (!name) return {};
  const sports = await prisma.sport.findMany({
    where: { name: { contains: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (sports.length === 0) return { error: `No sport found matching "${name}".` };
  return { sportIds: sports.map((s) => s.id) };
}

// ── Shared JSON-schema fragments ────────────────────────────────────────────
const PERIOD_PROPS = {
  period: {
    type: "string",
    enum: PRESETS,
    description:
      "Named reporting window. Financial year is Apr-Mar. Omit to use the report's default window. Ignored when customRange is provided.",
  },
  customRange: {
    type: "object",
    description: "Explicit inclusive date window as YYYY-MM-DD strings; overrides `period` when provided.",
    properties: {
      from: { type: "string", description: "Start date, YYYY-MM-DD (inclusive)." },
      to: { type: "string", description: "End date, YYYY-MM-DD (inclusive)." },
    },
    required: ["from", "to"],
  },
} as const;

const REP_PROP = {
  repName: {
    type: "string",
    description: "Optional: restrict to a single sales rep by name (partial, case-insensitive). Admin only; ignored for scoped users.",
  },
} as const;

function schema(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "object", properties: { ...PERIOD_PROPS, ...REP_PROP, ...extra }, required: [] };
}

// ── Toolbox ─────────────────────────────────────────────────────────────────
export function buildAnalyticsToolbox(scope: AnalyticsScope, defaultPeriod: PeriodInput = "all_time"): AiTool[] {
  // Resolve period + owner scope (+ optional sport) for a standard
  // AnalyticsFilter-shaped tool. Returns an error bag the handler surfaces to
  // the model instead of running a query with a bad filter.
  async function ctx(
    input: Record<string, unknown>,
    opts: { sport?: boolean } = {},
  ): Promise<{ filter: AnalyticsFilter; from: Date; to: Date; ownerIds?: string[] } | { error: string }> {
    const { from, to } = resolvePeriod(pickPeriod(input), defaultPeriod);
    const owner = await resolveOwnerIds(scope, input.repName);
    if (owner.error) return { error: owner.error };
    let sportIds: string[] | undefined;
    if (opts.sport) {
      const s = await resolveSportIds(input.sportName);
      if (s.error) return { error: s.error };
      sportIds = s.sportIds;
    }
    const filter: AnalyticsFilter = {
      from,
      to,
      dealChannel: "crm",
      ...(owner.ownerIds ? { ownerIds: owner.ownerIds } : {}),
      ...(sportIds ? { sportIds } : {}),
    };
    return { filter, from, to, ownerIds: owner.ownerIds };
  }

  const pseudoUser: { id: string; role: Role } = scope.companyWide
    ? { id: "company", role: "admin" }
    : { id: scope.ownerIds?.[0] ?? "self", role: "sales" };

  return [
    {
      name: "kpi_board",
      description:
        "Headline KPI board for the period: won revenue, target progress (target vs actual, pace, gap), overall win rate with n, average project value, sales velocity, deals created, and (company-wide) the per-rep revenue ranking. Best first call for a broad 'how are we doing' question.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        return getKpiBoard(pseudoUser, c.filter, { start: c.from, end: c.to });
      },
    },
    {
      name: "sales_activity_by_rep",
      description:
        "Per-rep activity table: leads created, deals created, site visits, samples sent, quotations sent (incl. revisions) and unique deals quoted, quoted value, deals won/closed, won value, win rate, and average sales-cycle days (null below the min sample size). Use for 'who did what / how much did each person sell'.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        return salesActivity(c.filter);
      },
    },
    {
      name: "rep_comparison",
      description:
        "Head-to-head rep comparison: won revenue, win rate (with n), average cycle days (with n), and average project value per rep, ranked by revenue. Metrics are suppressed to null below the min sample size. Use to compare or rank reps fairly.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        return repComparison(c.filter);
      },
    },
    {
      name: "target_progress",
      description:
        "Target vs actual for the period: target revenue/deals (null if no target is set), won revenue and deals, expected pace to date, gap to target, open pipeline value and probability-weighted pipeline. Use for 'are we on track to hit target'.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        const ownerIds = c.filter.ownerIds;
        const targetScope: TargetScope =
          ownerIds && ownerIds.length === 1 ? { scopeType: "USER", scopeId: ownerIds[0] } : { scopeType: "COMPANY", scopeId: null };
        const period: TargetPeriod = { type: inferPeriodType(c.from, c.to), start: c.from, end: c.to };
        return getTargetProgress(targetScope, period, c.filter);
      },
    },
    {
      name: "product_analytics",
      description:
        "Flooring product analytics (product tracking is flooring-scoped): monthly movement (enquiries/quoted/won with value), quoted→won conversion per product (flagged when high-enquiry but low-conversion), a product×city won-value heatmap, a product×customer-segment enquiry matrix, and the distinct years present. Use for product demand and conversion questions.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        return productAnalytics(c.filter);
      },
    },
    {
      name: "geography_cities",
      description:
        "Per-city breakdown: enquiries, quotations, won count, won value, win rate, average deal size, average cycle days, plus a ranked per-city rep breakdown; and a city-tier rollup (with an 'Unclassified' bucket). Use for 'which cities/regions are strongest'.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        return geography(c.filter);
      },
    },
    {
      name: "lead_source_analytics",
      description:
        "Per lead-source (marketing channel) performance: leads, qualified, deals, quoted, won, won value, lead→won rate, average cycle, and (empty until ad spend is entered) CAC/ROAS/cost-per-lead; plus source×city and source×product cross-tabs. Use for 'which channels/sources work best'.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        return sourceAnalytics(c.filter);
      },
    },
    {
      name: "pipeline_funnel",
      description:
        "Current pipeline snapshot: for each funnel stage the count and value of open deals sitting there right now, plus a breakdown of loss reasons for deals lost within the window. Use for 'what does the pipeline look like' or 'why are we losing deals'.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        return funnelSnapshot(c.filter);
      },
    },
    {
      name: "stage_velocity",
      description:
        "How long deals spend in each funnel stage before advancing: median and p90 days per stage with n (suppressed below the min sample size). Optionally sliced by sport. Use for 'where do deals get stuck / stage bottlenecks'.",
      input_schema: schema({
        sportName: { type: "string", description: "Optional: restrict to deals involving a sport, by name (partial, case-insensitive)." },
      }),
      handler: async (input) => {
        const c = await ctx(input ?? {}, { sport: true });
        if ("error" in c) return c;
        return stageVelocity(c.filter);
      },
    },
    {
      name: "win_loss_by_segment",
      description:
        "Win vs loss counts cross-cut by ONE segment dimension and loss reason. Choose dimension = sector (customer profile), region (city), or product. Use for 'why do we lose in segment X' or 'which segments win/lose most'.",
      input_schema: schema({
        dimension: {
          type: "string",
          enum: ["sector", "region", "product"],
          description: "Segment dimension to cross-cut win/loss by. Defaults to sector.",
        },
      }),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        const dim = input?.dimension === "region" || input?.dimension === "product" ? input.dimension : "sector";
        return winLossBySegment(dim, c.filter);
      },
    },
    {
      name: "seasonality",
      description:
        "Seasonal demand shape by sport across ALL deal history (the date window is ignored on purpose — a season needs multiple years overlaid; owner scope still applies): per-sport monthly enquiries/won/won-value and a seasonal index (null until 2+ distinct years exist). Use for 'which months/sports are seasonal'.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        return seasonality(c.filter);
      },
    },
    {
      name: "invoice_analytics",
      description:
        "Invoicing & collections for the period (company-wide, not rep-scoped): invoiced value and count, collected, outstanding, overdue, collection rate, average days-to-pay; a per-rep breakdown; and a monthly invoiced-vs-received series. Use for cash-collection and billing questions.",
      input_schema: { type: "object", properties: { ...PERIOD_PROPS }, required: [] },
      handler: async (input) => {
        const { from, to } = resolvePeriod(pickPeriod(input ?? {}), defaultPeriod);
        return getInvoiceAnalytics({ from, to });
      },
    },
    {
      name: "open_deals_by_rep",
      description:
        "The live workload: open (unclosed) deals each rep is actively working right now — customer, stage, value, interested products, latest note and next reminder — one row per deal. Optionally narrow by rep, sport, or city. Use for 'what is each rep handling now / who is overloaded'.",
      input_schema: schema({
        sportName: { type: "string", description: "Optional: restrict to deals involving a sport, by name (partial, case-insensitive)." },
        city: { type: "string", description: "Optional: restrict to one city (exact match on the resolved deal city)." },
      }),
      handler: async (input) => {
        const { from, to } = resolvePeriod(pickPeriod(input ?? {}), defaultPeriod);
        const owner = await resolveOwnerIds(scope, input?.repName);
        if (owner.error) return owner;
        const sport = await resolveSportIds(input?.sportName);
        if (sport.error) return sport;
        const drilldown: DealsDrilldownFilter = {
          outcome: null, // open deals only
          from,
          to,
          ...(owner.ownerIds ? { ownerIds: owner.ownerIds } : {}),
          ...(sport.sportIds?.length ? { sportId: sport.sportIds[0] } : {}),
          ...(typeof input?.city === "string" && input.city.trim() ? { city: input.city.trim() } : {}),
        };
        return getDealsDrilldown(drilldown);
      },
    },
  ];
}
