// Analytics over the captured Meta lead-gen submissions (MetaLead). Everything
// the Lead analytics page shows comes from getLeadAnalytics(), which runs a
// handful of light queries instead of one whole-table read per chart:
//   • one groupBy (city, sport) for the city / sport tallies,
//   • one slim read of { city, sport, campaignName, campaignId, fieldData } for
//     the parts that live in the form answers (job, area, top campaigns,
//     campaign summary),
//   • one read of just the leads that have salesData,
//   • repeat submitters: a groupBy on normalizedPhone (count > 1), then only
//     those leads plus phone-less leads that have an email.
// City/sport were extracted to real columns at ingest (leads.ts) and are
// re-normalized here with normalizeLabel so "salem"/"SALEM"/"Salem" collapse to
// one bucket; a missing value becomes "Unknown".
//
// Windowing matches the rest of the Meta reads: a lead falls in [from, to] by
// its Meta submit time (createdAtMeta) when present, else its ingest time
// (createdAt), so leads that arrived without a Meta timestamp aren't dropped.

import { prisma } from "@/lib/prisma";
import { normalizeLabel, parseFieldDataJson } from "./fieldMap";

type Range = { from: Date; to: Date };

const UNKNOWN = "Unknown";

// Job title isn't a real MetaLead column (unlike city/sport) — it lives in the
// form answers (field_data), so we read it out of the stored JSON. Match the
// question by these name fragments (Meta slugifies the form label, e.g.
// "job_title"), case-insensitively.
const JOB_ALIASES = ["job_title", "job title", "job", "designation", "occupation", "profession"];
function extractJob(fieldDataJson: string | null): string | null {
  // Exact alias match wins anywhere in the form; fall back to the first substring
  // match only if nothing matches exactly — so a field like
  // "professional_experience_years" can't hijack the real "job_title" answer
  // (mirrors the exact-then-substring rule in fieldMap.findByAlias).
  let contains: string | null = null;
  for (const f of parseFieldDataJson(fieldDataJson)) {
    const name = (f.name ?? "").toLowerCase().trim();
    if (!name) continue;
    const v = f.value?.trim();
    if (!v) continue;
    if (JOB_ALIASES.some((a) => name === a)) return v;
    if (contains === null && JOB_ALIASES.some((a) => name.includes(a))) contains = v;
  }
  return contains;
}

// Area (in sq.ft) isn't a MetaLead column either - it lives in the form answers
// as a bracket like "5k-10k_sq.ft". Match the "...area (in sq.ft)...?" question
// (name contains both "area" and "sq", which excludes the free-text "dimensions"
// questions and the locality "area"), and tidy the value for display.
const cleanArea = (v: string): string =>
  v.replace(/_/g, " ").replace(/(\d)(sq)/gi, "$1 $2").replace(/\s+/g, " ").trim();
function extractArea(fieldDataJson: string | null): string | null {
  for (const f of parseFieldDataJson(fieldDataJson)) {
    const name = (f.name ?? "").toLowerCase().trim();
    if (!name) continue;
    if (name.includes("area") && name.includes("sq")) {
      const v = f.value?.trim();
      if (v) return cleanArea(v);
    }
  }
  return null;
}

function leadWindowWhere({ from, to }: Range) {
  return {
    OR: [
      { createdAtMeta: { gte: from, lte: to } },
      { createdAtMeta: null, createdAt: { gte: from, lte: to } },
    ],
  };
}

export type LeadCityRow = { city: string; count: number };

export type SportCityCell = { city: string; sport: string; count: number };

export type JobCityCell = { job: string; city: string; sport: string; count: number };

export type AreaCityCell = { area: string; city: string; count: number };

export type RepeatLeadCapture = { campaignName: string | null; capturedAt: string }; // ISO
export type RepeatLeadRow = {
  name: string | null;
  phone: string | null;
  campaignCount: number; // DISTINCT campaignId count (the reason they qualified)
  campaigns: RepeatLeadCapture[]; // every submission, ascending by capturedAt
  firstAt: string; // ISO — earliest submission
  lastAt: string; // ISO — latest submission
};

// People who submitted a lead form across MORE THAN ONE distinct campaign in
// the window — the "same person keeps coming back" signal. Deduped on
// normalizedPhone (E.164), falling back to lowercased email when there's no
// phone. Sorted by campaignCount desc (then most-recent first).
//
// Only leads that can possibly repeat are loaded: phones that appear more than
// once (found with a groupBy) plus leads that have no phone but have an email.
// The grouping below is the same as when every lead in the window was read.
export async function repeatLeads({ from, to }: Range): Promise<RepeatLeadRow[]> {
  const window = leadWindowWhere({ from, to });
  const repeatedPhones = await prisma.metaLead.groupBy({
    by: ["normalizedPhone"],
    where: { AND: [window, { normalizedPhone: { not: null } }, { normalizedPhone: { not: "" } }] },
    _count: { _all: true },
    having: { normalizedPhone: { _count: { gt: 1 } } },
  });
  const phones = repeatedPhones.map((g) => g.normalizedPhone).filter((p): p is string => !!p);

  const leads = await prisma.metaLead.findMany({
    where: {
      AND: [
        window,
        {
          OR: [
            ...(phones.length > 0 ? [{ normalizedPhone: { in: phones } }] : []),
            { normalizedPhone: null, email: { not: null } },
            { normalizedPhone: "", email: { not: null } },
          ],
        },
      ],
    },
    // Oldest first, so the shown name / phone is the earliest submission's.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      fullName: true,
      phone: true,
      email: true,
      normalizedPhone: true,
      campaignId: true,
      campaignName: true,
      createdAtMeta: true,
      createdAt: true,
    },
  });

  type Group = {
    name: string | null;
    phone: string | null;
    campaignIds: Set<string>;
    captures: { campaignName: string | null; at: Date }[];
  };
  const groups = new Map<string, Group>();

  for (const l of leads) {
    const key = l.normalizedPhone?.trim() || l.email?.trim().toLowerCase();
    if (!key) continue; // no dedupe key -> can't tell if this is a repeat
    const at = l.createdAtMeta ?? l.createdAt;
    const g =
      groups.get(key) ?? { name: null, phone: null, campaignIds: new Set<string>(), captures: [] };
    if (!g.name && l.fullName) g.name = l.fullName;
    if (!g.phone && (l.normalizedPhone || l.phone)) g.phone = l.normalizedPhone ?? l.phone;
    if (l.campaignId) g.campaignIds.add(l.campaignId);
    g.captures.push({ campaignName: l.campaignName, at });
    groups.set(key, g);
  }

  const rows: RepeatLeadRow[] = [];
  for (const g of groups.values()) {
    if (g.campaignIds.size <= 1) continue; // must span >1 DISTINCT campaign
    const captures = g.captures.slice().sort((a, b) => a.at.getTime() - b.at.getTime());
    rows.push({
      name: g.name,
      phone: g.phone,
      campaignCount: g.campaignIds.size,
      campaigns: captures.map((c) => ({ campaignName: c.campaignName, capturedAt: c.at.toISOString() })),
      firstAt: captures[0].at.toISOString(),
      lastAt: captures[captures.length - 1].at.toISOString(),
    });
  }

  return rows.sort((a, b) => b.campaignCount - a.campaignCount || b.lastAt.localeCompare(a.lastAt));
}

// ---------------------------------------------------------------------------
// Sales follow-up analytics — reads from salesData JSON entered by reps.
// ---------------------------------------------------------------------------

type SalesJson = {
  sport?: string;
  dimension?: string;
  location?: string;
  jobTitle?: string;
  timeline?: string;
  b2bB2c?: string;
  custom?: { name: string; value: string }[];
};

function parseSales(raw: string | null): SalesJson | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export type B2bB2cRow = { type: string; count: number };

export type SalesSportRow = { sport: string; count: number };

export type SalesTimelineRow = { timeline: string; count: number };

export type CustomFieldRow = { field: string; value: string; count: number };

// Top-performing campaign per dimension value — one query, all dimensions.
export type TopCampaignMap = {
  byCity: Record<string, string>;
  bySport: Record<string, string>;
  byArea: Record<string, string>;
  byJob: Record<string, string>;
  overall: string | null;
};

export type CampaignSummaryRow = { campaignName: string; leadCount: number; metaCampaignId: string | null };

// Top campaign per sales-data dimension (b2bB2c, sport, timeline).
export type SalesTopCampaignMap = {
  byB2bB2c: Record<string, string>;
  bySport: Record<string, string>;
  byTimeline: Record<string, string>;
};

// For each dimension value, the campaign with the most leads (first one wins a tie).
function topOf(entries: [string, Map<string, number>][]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [dim, campMap] of entries) {
    let best = "";
    let bestCount = 0;
    for (const [camp, count] of campMap) {
      if (count > bestCount) { best = camp; bestCount = count; }
    }
    if (best) result[dim] = best;
  }
  return result;
}

export type LeadAnalytics = {
  byCity: LeadCityRow[];
  sportByCity: SportCityCell[];
  repeats: RepeatLeadRow[];
  jobs: JobCityCell[];
  areas: AreaCityCell[];
  b2bB2c: B2bB2cRow[];
  salesSports: SalesSportRow[];
  salesTimelines: SalesTimelineRow[];
  salesCustom: CustomFieldRow[];
  campaigns: CampaignSummaryRow[];
  topCampaigns: TopCampaignMap;
  salesTopCampaigns: SalesTopCampaignMap;
};

// Everything on the Lead analytics page for [from, to].
export async function getLeadAnalytics(range: Range): Promise<LeadAnalytics> {
  const where = leadWindowWhere(range);
  const [cityGroups, slim, salesRows, repeats] = await Promise.all([
    prisma.metaLead.groupBy({ by: ["city", "sport"], where, _count: { _all: true } }),
    prisma.metaLead.findMany({
      where,
      select: { city: true, sport: true, campaignName: true, campaignId: true, fieldData: true },
    }),
    prisma.metaLead.findMany({
      where: { AND: [where, { salesData: { not: null } }] },
      select: { salesData: true, campaignName: true },
    }),
    repeatLeads(range),
  ]);

  // ---- Leads by city + city x sport (from the grouped counts) ----
  const byCityMap = new Map<string, number>();
  const cityMap = new Map<string, Map<string, number>>();
  for (const g of cityGroups) {
    const n = g._count._all;
    const city = normalizeLabel(g.city) ?? UNKNOWN;
    const sport = normalizeLabel(g.sport) ?? UNKNOWN;
    byCityMap.set(city, (byCityMap.get(city) ?? 0) + n);
    const bySport = cityMap.get(city) ?? new Map<string, number>();
    bySport.set(sport, (bySport.get(sport) ?? 0) + n);
    cityMap.set(city, bySport);
  }
  const byCity = [...byCityMap.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
  // Flat city x sport cross-tab (one cell per non-empty combination) for a
  // stacked bar chart. Sorted city asc, then count desc within a city.
  const sportByCity = [...cityMap.entries()]
    .flatMap(([city, bySport]) => [...bySport.entries()].map(([sport, count]) => ({ city, sport, count })))
    .sort((a, b) => a.city.localeCompare(b.city) || b.count - a.count || a.sport.localeCompare(b.sport));

  // ---- Parts that live in the form answers (job, area, top campaigns, campaign summary) ----
  // Job x city x sport: leads with NO job stated are EXCLUDED (so an
  // all-"Unknown" job column can't mask the "no job data yet" empty state).
  const jobMap = new Map<string, JobCityCell>();
  // Area x city: leads with no area answer are excluded; blank city -> "Unknown".
  const areaMap = new Map<string, AreaCityCell>();
  const topCityMap = new Map<string, Map<string, number>>();
  const topSportMap = new Map<string, Map<string, number>>();
  const topAreaMap = new Map<string, Map<string, number>>();
  const topJobMap = new Map<string, Map<string, number>>();
  const overallMap = new Map<string, number>();
  const summaryMap = new Map<string, { count: number; metaId: string | null }>();

  for (const l of slim) {
    const city = normalizeLabel(l.city) ?? UNKNOWN;
    const sport = normalizeLabel(l.sport) ?? UNKNOWN;
    const area = extractArea(l.fieldData);
    const job = normalizeLabel(extractJob(l.fieldData));
    const camp = l.campaignName ?? "(unattributed)";

    if (job) {
      const key = `${job}||${city}||${sport}`;
      const e = jobMap.get(key) ?? { job, city, sport, count: 0 };
      e.count += 1;
      jobMap.set(key, e);
    }
    if (area) {
      const key = `${area}||${city}`;
      const e = areaMap.get(key) ?? { area, city, count: 0 };
      e.count += 1;
      areaMap.set(key, e);
    }

    overallMap.set(camp, (overallMap.get(camp) ?? 0) + 1);

    const cm = topCityMap.get(city) ?? new Map<string, number>();
    cm.set(camp, (cm.get(camp) ?? 0) + 1);
    topCityMap.set(city, cm);

    const sm = topSportMap.get(sport) ?? new Map<string, number>();
    sm.set(camp, (sm.get(camp) ?? 0) + 1);
    topSportMap.set(sport, sm);

    if (area) {
      const am = topAreaMap.get(area) ?? new Map<string, number>();
      am.set(camp, (am.get(camp) ?? 0) + 1);
      topAreaMap.set(area, am);
    }
    if (job) {
      const jm = topJobMap.get(job) ?? new Map<string, number>();
      jm.set(camp, (jm.get(camp) ?? 0) + 1);
      topJobMap.set(job, jm);
    }

    const sum = summaryMap.get(camp) ?? { count: 0, metaId: l.campaignId };
    sum.count += 1;
    summaryMap.set(camp, sum);
  }

  const jobs = [...jobMap.values()].sort((a, b) => b.count - a.count || a.job.localeCompare(b.job));
  const areas = [...areaMap.values()].sort((a, b) => b.count - a.count || a.area.localeCompare(b.area));

  let overallBest: string | null = null;
  let overallMax = 0;
  for (const [camp, count] of overallMap) {
    if (count > overallMax) { overallBest = camp; overallMax = count; }
  }
  const topCampaigns: TopCampaignMap = {
    byCity: topOf([...topCityMap.entries()]),
    bySport: topOf([...topSportMap.entries()]),
    byArea: topOf([...topAreaMap.entries()]),
    byJob: topOf([...topJobMap.entries()]),
    overall: overallBest,
  };

  const campaigns: CampaignSummaryRow[] = [...summaryMap.entries()]
    .map(([campaignName, v]) => ({ campaignName, leadCount: v.count, metaCampaignId: v.metaId }))
    .sort((a, b) => b.leadCount - a.leadCount);

  // ---- Sales follow-up data entered by reps (only leads that have some) ----
  const b2bMap = new Map<string, number>();
  const salesSportMap = new Map<string, number>();
  const timelineMap = new Map<string, number>();
  const customMap = new Map<string, number>();
  const topB2bMap = new Map<string, Map<string, number>>();
  const topSalesSportMap = new Map<string, Map<string, number>>();
  const topTimelineMap = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, dim: string, camp: string) => {
    const inner = m.get(dim) ?? new Map<string, number>();
    inner.set(camp, (inner.get(camp) ?? 0) + 1);
    m.set(dim, inner);
  };

  for (const l of salesRows) {
    const s = parseSales(l.salesData ?? null);
    if (!s) continue;
    const camp = l.campaignName ?? "(unattributed)";

    const b2b = s.b2bB2c?.trim();
    if (b2b) {
      b2bMap.set(b2b, (b2bMap.get(b2b) ?? 0) + 1);
      bump(topB2bMap, b2b, camp);
    }
    const sport = normalizeLabel(s.sport);
    if (sport) {
      salesSportMap.set(sport, (salesSportMap.get(sport) ?? 0) + 1);
      bump(topSalesSportMap, sport, camp);
    }
    const tl = s.timeline?.trim();
    if (tl) {
      timelineMap.set(tl, (timelineMap.get(tl) ?? 0) + 1);
      bump(topTimelineMap, tl, camp);
    }
    if (Array.isArray(s.custom)) {
      for (const cf of s.custom) {
        const n = cf.name?.trim();
        const v = cf.value?.trim();
        if (!n || !v) continue;
        const key = `${n}||${v}`;
        customMap.set(key, (customMap.get(key) ?? 0) + 1);
      }
    }
  }

  return {
    byCity,
    sportByCity,
    repeats,
    jobs,
    areas,
    b2bB2c: [...b2bMap.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    salesSports: [...salesSportMap.entries()].map(([sport, count]) => ({ sport, count })).sort((a, b) => b.count - a.count),
    salesTimelines: [...timelineMap.entries()].map(([timeline, count]) => ({ timeline, count })).sort((a, b) => b.count - a.count),
    salesCustom: [...customMap.entries()]
      .map(([k, count]) => { const [field, value] = k.split("||"); return { field, value, count }; })
      .sort((a, b) => b.count - a.count),
    campaigns,
    topCampaigns,
    salesTopCampaigns: {
      byB2bB2c: topOf([...topB2bMap.entries()]),
      bySport: topOf([...topSalesSportMap.entries()]),
      byTimeline: topOf([...topTimelineMap.entries()]),
    },
  };
}
