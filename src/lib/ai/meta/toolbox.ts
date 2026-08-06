// Phase 6 (Meta ad-campaign AI summaries) — the tool layer. Mirrors
// analytics/toolbox.ts: every tool here wraps ONE real Prisma query over the
// Meta ad tables (MetaCampaign / AdInsight / MetaLead) and returns its JSON
// verbatim, so the model can only ever report numbers a real DB query produced
// — it never computes or invents a figure itself. Each handler resolves the
// model-supplied period into a concrete {from,to} window and (optionally) a
// named-campaign filter. Unlike the analytics toolbox this is ads data, so it
// does NOT force dealChannel:"crm" or any owner scope — ad performance is not
// rep-owned.
import { prisma } from "@/lib/prisma";
import type { AiTool } from "@/lib/ai/tools";
import { startOfDayIST, endOfDayIST } from "@/lib/time";
import { normalizeLabel } from "@/lib/meta-ads/fieldMap";
import { repeatLeads } from "@/lib/meta-ads/leadAnalytics";

// ── Period handling ─────────────────────────────────────────────────────────
// Rolling windows are the natural unit for ad reporting (in-flight days keep
// updating), so the presets lean on last-N-days plus a couple of calendar
// buckets. Each tool may name its own period; otherwise the toolbox default
// applies.
export type PeriodPreset =
  | "last_7_days"
  | "last_30_days"
  | "last_90_days"
  | "this_month"
  | "last_month"
  | "this_year"
  | "all_time";
export type PeriodInput = PeriodPreset | { from: string; to: string };

const PRESETS: PeriodPreset[] = [
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "this_month",
  "last_month",
  "this_year",
  "all_time",
];

const DAY_MS = 86_400_000;

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
  const to = endOfDayIST(now);
  switch (preset) {
    case "last_7_days":
      return { from: startOfDayIST(new Date(now.getTime() - 6 * DAY_MS)), to };
    case "last_30_days":
      return { from: startOfDayIST(new Date(now.getTime() - 29 * DAY_MS)), to };
    case "last_90_days":
      return { from: startOfDayIST(new Date(now.getTime() - 89 * DAY_MS)), to };
    case "this_month":
      return { from: startOfDayIST(new Date(now.getFullYear(), now.getMonth(), 1)), to };
    case "last_month": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: startOfDayIST(first), to: endOfDayIST(last) };
    }
    case "this_year":
      return { from: startOfDayIST(new Date(now.getFullYear(), 0, 1)), to };
    case "all_time":
    default:
      return { from: new Date(0), to };
  }
}

// Coerce an untrusted value (model tool input) into a PeriodInput, or undefined.
function coercePeriodInput(raw: unknown): PeriodInput | undefined {
  if (typeof raw === "string" && (PRESETS as string[]).includes(raw)) return raw as PeriodPreset;
  if (raw && typeof raw === "object") {
    const o = raw as { from?: unknown; to?: unknown };
    if (typeof o.from === "string" && typeof o.to === "string") return { from: o.from, to: o.to };
  }
  return undefined;
}

function resolvePeriod(input: PeriodInput | undefined | null, fallback: PeriodInput): { from: Date; to: Date } {
  const chosen = input ?? fallback;
  if (typeof chosen === "string") return presetRange(chosen);
  const from = parseStart(chosen.from);
  const to = parseEnd(chosen.to);
  if (from && to) return { from, to };
  return typeof fallback === "string" ? presetRange(fallback) : presetRange("all_time");
}

// The period the model chose for a tool call: an explicit customRange wins over
// a named preset; both are optional (falls back to the toolbox default).
function pickPeriod(input: Record<string, unknown>): PeriodInput | undefined {
  const cr = input?.customRange;
  if (cr && typeof cr === "object") {
    const o = cr as { from?: unknown; to?: unknown };
    if (typeof o.from === "string" && typeof o.to === "string") return { from: o.from, to: o.to };
  }
  return typeof input?.period === "string" ? coercePeriodInput(input.period) : undefined;
}

// ── Small numeric + date helpers ────────────────────────────────────────────
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// IST calendar day key (UTC+5:30) so a day's insights/leads group under the
// same local date the rest of the app uses.
function dayKeyIST(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  return ist.toISOString().slice(0, 10);
}

function describeWindow(from: Date, to: Date): { from: string; to: string } {
  return { from: from.getTime() <= 0 ? "all time" : dayKeyIST(from), to: dayKeyIST(to) };
}

// ── Shared JSON-schema fragments ────────────────────────────────────────────
const PERIOD_PROPS = {
  period: {
    type: "string",
    enum: PRESETS,
    description:
      "Named reporting window over ad-campaign data. Omit to use the report's default window. Ignored when customRange is provided.",
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

const CAMPAIGN_PROP = {
  campaignName: {
    type: "string",
    description: "Optional: restrict to ad campaigns whose name contains this text (partial, case-insensitive).",
  },
} as const;

function schema(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "object", properties: { ...PERIOD_PROPS, ...CAMPAIGN_PROP, ...extra }, required: [] };
}

// ── Per-campaign rollup shared by the insight-based tools ────────────────────
type InsightRow = {
  campaignId: string;
  spend: unknown;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  date: Date;
  campaign: { name: string; metaId: string; objective: string | null; status: string | null } | null;
};

// ONE query: all per-day campaign insight rows in the window (optionally scoped
// to named campaigns), with the parent campaign joined in. The tools roll these
// real rows up in-process — aggregating actual DB rows, never inventing.
async function loadInsights(from: Date, to: Date, campaignIds?: string[]): Promise<InsightRow[]> {
  return prisma.adInsight.findMany({
    where: {
      date: { gte: from, lte: to },
      ...(campaignIds ? { campaignId: { in: campaignIds } } : {}),
    },
    include: { campaign: { select: { name: true, metaId: true, objective: true, status: true } } },
    orderBy: { date: "asc" },
  });
}

type CampRoll = {
  campaignId: string; // the Meta campaign id
  campaign: string;
  objective: string | null;
  status: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  ctr: number | null;
  cpl: number | null;
};

function rollupByCampaign(rows: InsightRow[]): CampRoll[] {
  const map = new Map<
    string,
    { metaId: string; name: string; objective: string | null; status: string | null; spend: number; impressions: number; reach: number; clicks: number; leads: number }
  >();
  for (const r of rows) {
    const e =
      map.get(r.campaignId) ?? {
        metaId: r.campaign?.metaId ?? r.campaignId,
        name: r.campaign?.name ?? "(unknown campaign)",
        objective: r.campaign?.objective ?? null,
        status: r.campaign?.status ?? null,
        spend: 0,
        impressions: 0,
        reach: 0,
        clicks: 0,
        leads: 0,
      };
    e.spend += Number(r.spend);
    e.impressions += r.impressions;
    e.reach += r.reach;
    e.clicks += r.clicks;
    e.leads += r.leads;
    map.set(r.campaignId, e);
  }
  return [...map.values()].map((e) => ({
    campaignId: e.metaId,
    campaign: e.name,
    objective: e.objective,
    status: e.status,
    spend: round2(e.spend),
    impressions: e.impressions,
    reach: e.reach,
    clicks: e.clicks,
    leads: e.leads,
    ctr: e.impressions > 0 ? round2((e.clicks / e.impressions) * 100) : null,
    cpl: e.leads > 0 ? round2(e.spend / e.leads) : null,
  }));
}

function totalsOf(rows: InsightRow[]) {
  let spend = 0,
    impressions = 0,
    reach = 0,
    clicks = 0,
    leads = 0;
  for (const r of rows) {
    spend += Number(r.spend);
    impressions += r.impressions;
    reach += r.reach;
    clicks += r.clicks;
    leads += r.leads;
  }
  return {
    spend: round2(spend),
    impressions,
    reach,
    clicks,
    leads,
    ctr: impressions > 0 ? round2((clicks / impressions) * 100) : null,
    cpl: leads > 0 ? round2(spend / leads) : null,
  };
}

// ── Toolbox ─────────────────────────────────────────────────────────────────
export function buildMetaAdsToolbox(defaultPeriod: PeriodInput = "last_30_days"): AiTool[] {
  // Resolve the period (+ optional named-campaign filter) for a tool call.
  // Returns an error bag the handler surfaces to the model instead of running a
  // query with a bad filter — mirrors analytics/toolbox.ts's ctx().
  async function ctx(
    input: Record<string, unknown>,
  ): Promise<{ from: Date; to: Date; campaignIds?: string[]; campaignMetaIds?: string[] } | { error: string }> {
    const { from, to } = resolvePeriod(pickPeriod(input), defaultPeriod);
    const name = typeof input.campaignName === "string" ? input.campaignName.trim() : "";
    if (name) {
      const found = await prisma.metaCampaign.findMany({
        where: { name: { contains: name, mode: "insensitive" } },
        select: { id: true, metaId: true },
      });
      if (found.length === 0) return { error: `No ad campaign found matching "${name}".` };
      return { from, to, campaignIds: found.map((c) => c.id), campaignMetaIds: found.map((c) => c.metaId) };
    }
    return { from, to };
  }

  return [
    {
      name: "campaign_performance",
      description:
        "Per-campaign performance rollup for the window: spend (INR), impressions, reach, clicks, leads, CTR (%) and cost-per-lead (CPL) for each ad campaign, plus period totals. Best first call for a broad 'how are the ads doing' question. Optionally narrowed to one campaign by name.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        const rows = await loadInsights(c.from, c.to, c.campaignIds);
        const campaigns = rollupByCampaign(rows).sort((a, b) => b.spend - a.spend);
        return {
          window: describeWindow(c.from, c.to),
          campaignCount: campaigns.length,
          totals: totalsOf(rows),
          campaigns,
        };
      },
    },
    {
      name: "lead_volume",
      description:
        "Captured lead-form (Instant Form) submissions in the window, from the real leads pulled off Meta: total count plus breakdowns by campaign, by form, and by day. Use for 'how many leads did the ads bring in' or 'which campaign/form generated the most leads'.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        const leads = await prisma.metaLead.findMany({
          where: {
            OR: [
              { createdAtMeta: { gte: c.from, lte: c.to } },
              { createdAtMeta: null, createdAt: { gte: c.from, lte: c.to } },
            ],
            // MetaLead.campaignId stores the RAW Meta campaign id (join to
            // MetaCampaign.metaId), so filter on metaIds, not internal ids.
            ...(c.campaignMetaIds ? { campaignId: { in: c.campaignMetaIds } } : {}),
          },
          select: { campaignId: true, campaignName: true, formId: true, formName: true, createdAtMeta: true, createdAt: true },
        });
        const byCampaign = new Map<string, number>();
        const byForm = new Map<string, number>();
        const byDay = new Map<string, number>();
        for (const l of leads) {
          const camp = l.campaignName || l.campaignId || "(unattributed)";
          const form = l.formName || l.formId || "(unknown form)";
          const day = dayKeyIST(l.createdAtMeta ?? l.createdAt);
          byCampaign.set(camp, (byCampaign.get(camp) ?? 0) + 1);
          byForm.set(form, (byForm.get(form) ?? 0) + 1);
          byDay.set(day, (byDay.get(day) ?? 0) + 1);
        }
        const toRows = (m: Map<string, number>, key: string) =>
          [...m.entries()].map(([k, count]) => ({ [key]: k, count })).sort((a, b) => b.count - a.count);
        return {
          window: describeWindow(c.from, c.to),
          total: leads.length,
          byCampaign: toRows(byCampaign, "campaign"),
          byForm: toRows(byForm, "form"),
          byDay: [...byDay.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
        };
      },
    },
    {
      name: "by_city",
      description:
        "Captured lead-form submissions broken down by the CITY the lead entered on the form, most leads first. Blank/unknown city is bucketed as 'Unknown'. Use for 'which cities are our leads coming from', 'where should we focus outreach', or any location question about the leads.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        const leads = await prisma.metaLead.findMany({
          where: {
            OR: [
              { createdAtMeta: { gte: c.from, lte: c.to } },
              { createdAtMeta: null, createdAt: { gte: c.from, lte: c.to } },
            ],
            // MetaLead.campaignId is the RAW Meta id (join to MetaCampaign.metaId).
            ...(c.campaignMetaIds ? { campaignId: { in: c.campaignMetaIds } } : {}),
          },
          select: { city: true },
        });
        const byCity = new Map<string, number>();
        for (const l of leads) {
          const city = normalizeLabel(l.city) ?? "Unknown";
          byCity.set(city, (byCity.get(city) ?? 0) + 1);
        }
        return {
          window: describeWindow(c.from, c.to),
          total: leads.length,
          byCity: [...byCity.entries()]
            .map(([city, count]) => ({ city, count }))
            .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city)),
        };
      },
    },
    {
      name: "by_sport",
      description:
        "Captured leads broken down by the SPORT / interest the lead selected on the form: an overall demand ranking (which sport is asked for most) plus a city-by-sport cross-tab (what each city most wants). Blank values bucket as 'Unknown'. Use for 'which sport is most in demand' or 'what does each city want'.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        const leads = await prisma.metaLead.findMany({
          where: {
            OR: [
              { createdAtMeta: { gte: c.from, lte: c.to } },
              { createdAtMeta: null, createdAt: { gte: c.from, lte: c.to } },
            ],
            // MetaLead.campaignId is the RAW Meta id (join to MetaCampaign.metaId).
            ...(c.campaignMetaIds ? { campaignId: { in: c.campaignMetaIds } } : {}),
          },
          select: { city: true, sport: true },
        });
        const bySport = new Map<string, number>();
        const cityMap = new Map<string, Map<string, number>>();
        for (const l of leads) {
          const city = normalizeLabel(l.city) ?? "Unknown";
          const sport = normalizeLabel(l.sport) ?? "Unknown";
          bySport.set(sport, (bySport.get(sport) ?? 0) + 1);
          const inner = cityMap.get(city) ?? new Map<string, number>();
          inner.set(sport, (inner.get(sport) ?? 0) + 1);
          cityMap.set(city, inner);
        }
        return {
          window: describeWindow(c.from, c.to),
          total: leads.length,
          bySport: [...bySport.entries()]
            .map(([sport, count]) => ({ sport, count }))
            .sort((a, b) => b.count - a.count || a.sport.localeCompare(b.sport)),
          byCityAndSport: [...cityMap.entries()]
            .flatMap(([city, inner]) => [...inner.entries()].map(([sport, count]) => ({ city, sport, count })))
            .sort((a, b) => a.city.localeCompare(b.city) || b.count - a.count || a.sport.localeCompare(b.sport)),
        };
      },
    },
    {
      name: "repeat_leads",
      description:
        "People who submitted lead forms across MORE THAN ONE distinct ad campaign in the window (deduped by phone, else email) — the 'same person keeps coming back' signal. Each row: the person, how many distinct campaigns they appear in, the campaign submissions, and first/last submit time. Use for 'who are our repeat leads' or 'which people engaged multiple times'.",
      // Period-only schema: repeat_leads is inherently cross-campaign, so it must
      // NOT advertise a campaignName filter — a non-matching name would make ctx()
      // return a false "no campaign found" error and the model would wrongly report
      // "not enough data" even though repeat leads exist.
      input_schema: { type: "object", properties: { ...PERIOD_PROPS }, required: [] },
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        // "Repeat" means the same person across >1 DISTINCT campaign, so a
        // single-campaign filter would be self-defeating — this deliberately
        // reads every campaign in the window (leadAnalytics.repeatLeads does the
        // dedupe + distinct-campaign JS reduce and returns serialized rows).
        const rows = await repeatLeads({ from: c.from, to: c.to });
        return {
          window: describeWindow(c.from, c.to),
          total: rows.length,
          repeatSubmitters: rows,
        };
      },
    },
    {
      name: "spend_vs_leads",
      description:
        "Spend vs leads for the window: overall totals (spend, leads, blended CPL, impressions, clicks, CTR) plus a per-day time series of spend and leads with that day's CPL. Use to see whether spend is translating into leads and how that trends day to day.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        const rows = await loadInsights(c.from, c.to, c.campaignIds);
        const byDay = new Map<string, { spend: number; leads: number; impressions: number; clicks: number }>();
        for (const r of rows) {
          const day = dayKeyIST(r.date);
          const e = byDay.get(day) ?? { spend: 0, leads: 0, impressions: 0, clicks: 0 };
          e.spend += Number(r.spend);
          e.leads += r.leads;
          e.impressions += r.impressions;
          e.clicks += r.clicks;
          byDay.set(day, e);
        }
        const daily = [...byDay.entries()]
          .map(([date, e]) => ({
            date,
            spend: round2(e.spend),
            leads: e.leads,
            cpl: e.leads > 0 ? round2(e.spend / e.leads) : null,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));
        return { window: describeWindow(c.from, c.to), totals: totalsOf(rows), daily };
      },
    },
    {
      name: "cost_per_lead",
      description:
        "Cost-per-lead (CPL) analysis for the window: overall blended CPL, and a per-campaign CPL ranking (cheapest first) for campaigns that produced leads. Campaigns that spent but produced zero leads are listed separately so wasted spend is visible. Use for 'which campaigns give the cheapest leads' or 'where are we wasting budget'.",
      input_schema: schema(),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        const rows = await loadInsights(c.from, c.to, c.campaignIds);
        const all = rollupByCampaign(rows);
        const withLeads = all
          .filter((e) => e.leads > 0)
          .map((e) => ({ campaign: e.campaign, campaignId: e.campaignId, spend: e.spend, leads: e.leads, cpl: e.cpl }))
          .sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity));
        const noLeadCampaigns = all
          .filter((e) => e.leads === 0 && e.spend > 0)
          .map((e) => ({ campaign: e.campaign, campaignId: e.campaignId, spend: e.spend }))
          .sort((a, b) => b.spend - a.spend);
        const t = totalsOf(rows);
        return {
          window: describeWindow(c.from, c.to),
          overall: { spend: t.spend, leads: t.leads, cpl: t.cpl },
          byCampaign: withLeads,
          noLeadCampaigns,
        };
      },
    },
    {
      name: "best_worst_campaigns",
      description:
        "Ranks campaigns by a chosen metric and returns the full ranking plus the single best and worst performer. metric = leads (default), spend, cpl (lower is better), or ctr. Campaigns with no value for the chosen metric (e.g. CPL when there were no leads) are excluded from that ranking. Use for 'what's my best/worst campaign'.",
      input_schema: schema({
        metric: {
          type: "string",
          enum: ["leads", "spend", "cpl", "ctr"],
          description: "Ranking metric. 'cpl' ranks cheapest-first (lower is better); the others rank highest-first. Defaults to leads.",
        },
      }),
      handler: async (input) => {
        const c = await ctx(input ?? {});
        if ("error" in c) return c;
        const metric = ((): "leads" | "spend" | "cpl" | "ctr" => {
          const m = input?.metric;
          return m === "spend" || m === "cpl" || m === "ctr" ? m : "leads";
        })();
        const rows = await loadInsights(c.from, c.to, c.campaignIds);
        const all = rollupByCampaign(rows);
        const lowerIsBetter = metric === "cpl";
        const ranked = all
          .filter((e) => e[metric] != null)
          .sort((a, b) => {
            const av = a[metric] as number;
            const bv = b[metric] as number;
            return lowerIsBetter ? av - bv : bv - av;
          });
        return {
          window: describeWindow(c.from, c.to),
          metric,
          campaignCount: ranked.length,
          best: ranked[0] ?? null,
          worst: ranked.length > 0 ? ranked[ranked.length - 1] : null,
          ranked,
        };
      },
    },
  ];
}
