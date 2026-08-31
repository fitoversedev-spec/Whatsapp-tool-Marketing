// Analytics over the captured Meta lead-gen submissions (MetaLead), grouped in
// JS from a single findMany — the same reduce-into-a-Map style the CRM
// analytics libs use (see src/lib/analytics/geography.ts + sources.ts), never
// prisma.groupBy. City/sport were extracted to real columns at ingest
// (leads.ts) and are re-normalized here with normalizeLabel so "salem"/"SALEM"/
// "Salem" collapse to one bucket; a missing value becomes "Unknown".
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

// Captured-lead volume by city, most leads first. null/blank city -> "Unknown".
export async function leadsByCity({ from, to }: Range): Promise<LeadCityRow[]> {
  const leads = await prisma.metaLead.findMany({
    where: leadWindowWhere({ from, to }),
    select: { city: true },
  });

  const byCity = new Map<string, number>();
  for (const l of leads) {
    const city = normalizeLabel(l.city) ?? UNKNOWN;
    byCity.set(city, (byCity.get(city) ?? 0) + 1);
  }

  return [...byCity.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
}

export type SportCityCell = { city: string; sport: string; count: number };

// Flat city x sport cross-tab (one cell per non-empty combination) for a
// stacked bar chart — built from a nested Map exactly like sources.ts's
// cityCrossTab. null/blank city or sport -> "Unknown". Sorted city asc, then
// count desc within a city, for a stable stacking order.
export async function sportByCity({ from, to }: Range): Promise<SportCityCell[]> {
  const leads = await prisma.metaLead.findMany({
    where: leadWindowWhere({ from, to }),
    select: { city: true, sport: true },
  });

  const cityMap = new Map<string, Map<string, number>>();
  for (const l of leads) {
    const city = normalizeLabel(l.city) ?? UNKNOWN;
    const sport = normalizeLabel(l.sport) ?? UNKNOWN;
    const bySport = cityMap.get(city) ?? new Map<string, number>();
    bySport.set(sport, (bySport.get(sport) ?? 0) + 1);
    cityMap.set(city, bySport);
  }

  return [...cityMap.entries()]
    .flatMap(([city, bySport]) => [...bySport.entries()].map(([sport, count]) => ({ city, sport, count })))
    .sort((a, b) => a.city.localeCompare(b.city) || b.count - a.count || a.sport.localeCompare(b.sport));
}

export type JobCityCell = { job: string; city: string; sport: string; count: number };

// Flat job x city x sport cross-tab (one cell per combination), so the UI can
// show "what job, from what city, wanting what sport" in one place and filter on
// any of the three. Job comes from the form answers (extractJob); city/sport from
// their columns. Leads with NO job stated are EXCLUDED (so an all-"Unknown" job
// column can't mask the "no job data yet" empty state); blank city/sport ->
// "Unknown". Sorted count desc.
export async function jobAnalytics({ from, to }: Range): Promise<JobCityCell[]> {
  const leads = await prisma.metaLead.findMany({
    where: leadWindowWhere({ from, to }),
    select: { city: true, sport: true, fieldData: true },
  });

  const map = new Map<string, JobCityCell>();
  for (const l of leads) {
    const job = normalizeLabel(extractJob(l.fieldData));
    if (!job) continue; // no job stated -> not part of the jobs cross-tab
    const city = normalizeLabel(l.city) ?? UNKNOWN;
    const sport = normalizeLabel(l.sport) ?? UNKNOWN;
    const key = `${job}||${city}||${sport}`;
    const e = map.get(key) ?? { job, city, sport, count: 0 };
    e.count += 1;
    map.set(key, e);
  }

  return [...map.values()].sort((a, b) => b.count - a.count || a.job.localeCompare(b.job));
}

// Flat area x city cross-tab (one cell per combination). The UI ranks areas
// within a chosen city, or cities within a chosen area (and vice versa). Leads
// with no area answer are excluded; blank city -> "Unknown". Sorted count desc.
export type AreaCityCell = { area: string; city: string; count: number };
export async function areaAnalytics({ from, to }: Range): Promise<AreaCityCell[]> {
  const leads = await prisma.metaLead.findMany({
    where: leadWindowWhere({ from, to }),
    select: { city: true, fieldData: true },
  });
  const map = new Map<string, AreaCityCell>();
  for (const l of leads) {
    const area = extractArea(l.fieldData);
    if (!area) continue;
    const city = normalizeLabel(l.city) ?? UNKNOWN;
    const key = `${area}||${city}`;
    const e = map.get(key) ?? { area, city, count: 0 };
    e.count += 1;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.area.localeCompare(b.area));
}

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
export async function repeatLeads({ from, to }: Range): Promise<RepeatLeadRow[]> {
  const leads = await prisma.metaLead.findMany({
    where: leadWindowWhere({ from, to }),
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

// Sales-data queries use fieldData in the Prisma select (salesData isn't in
// the generated client until the next prisma generate after a dev-server
// restart) and read salesData from the raw row via type assertion.
type SalesRow = { salesData?: string | null };

async function salesLeads({ from, to }: Range): Promise<SalesRow[]> {
  const leads = await (prisma.metaLead as any).findMany({
    where: leadWindowWhere({ from, to }),
    select: { salesData: true },
  });
  return leads as SalesRow[];
}

export type B2bB2cRow = { type: string; count: number };

export async function b2bB2cAnalytics(range: Range): Promise<B2bB2cRow[]> {
  const leads = await salesLeads(range);
  const map = new Map<string, number>();
  for (const l of leads) {
    const s = parseSales(l.salesData ?? null);
    const type = s?.b2bB2c?.trim();
    if (!type) continue;
    map.set(type, (map.get(type) ?? 0) + 1);
  }
  return [...map.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
}

export type SalesSportRow = { sport: string; count: number };

export async function salesSportAnalytics(range: Range): Promise<SalesSportRow[]> {
  const leads = await salesLeads(range);
  const map = new Map<string, number>();
  for (const l of leads) {
    const s = parseSales(l.salesData ?? null);
    const sport = normalizeLabel(s?.sport);
    if (!sport) continue;
    map.set(sport, (map.get(sport) ?? 0) + 1);
  }
  return [...map.entries()].map(([sport, count]) => ({ sport, count })).sort((a, b) => b.count - a.count);
}

export type SalesTimelineRow = { timeline: string; count: number };

export async function salesTimelineAnalytics(range: Range): Promise<SalesTimelineRow[]> {
  const leads = await salesLeads(range);
  const map = new Map<string, number>();
  for (const l of leads) {
    const s = parseSales(l.salesData ?? null);
    const tl = s?.timeline?.trim();
    if (!tl) continue;
    map.set(tl, (map.get(tl) ?? 0) + 1);
  }
  return [...map.entries()].map(([timeline, count]) => ({ timeline, count })).sort((a, b) => b.count - a.count);
}

export type CustomFieldRow = { field: string; value: string; count: number };

export async function salesCustomFieldAnalytics(range: Range): Promise<CustomFieldRow[]> {
  const leads = await salesLeads(range);
  const map = new Map<string, number>();
  for (const l of leads) {
    const s = parseSales(l.salesData ?? null);
    if (!Array.isArray(s?.custom)) continue;
    for (const cf of s!.custom) {
      const n = cf.name?.trim();
      const v = cf.value?.trim();
      if (!n || !v) continue;
      const key = `${n}||${v}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([k, count]) => { const [field, value] = k.split("||"); return { field, value, count }; })
    .sort((a, b) => b.count - a.count);
}

// Top-performing campaign per dimension value — one query, all dimensions.
export type TopCampaignMap = {
  byCity: Record<string, string>;
  bySport: Record<string, string>;
  byArea: Record<string, string>;
  byJob: Record<string, string>;
  overall: string | null;
};

export async function topCampaignPerDimension(range: Range): Promise<TopCampaignMap> {
  const leads = await prisma.metaLead.findMany({
    where: leadWindowWhere(range),
    select: { city: true, sport: true, fieldData: true, campaignName: true },
  });

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

  const cityMap = new Map<string, Map<string, number>>();
  const sportMap = new Map<string, Map<string, number>>();
  const areaMap = new Map<string, Map<string, number>>();
  const jobMap = new Map<string, Map<string, number>>();
  const overallMap = new Map<string, number>();

  for (const l of leads) {
    const camp = l.campaignName ?? "(unattributed)";
    const city = normalizeLabel(l.city) ?? UNKNOWN;
    const sport = normalizeLabel(l.sport) ?? UNKNOWN;
    const area = extractArea(l.fieldData);
    const job = normalizeLabel(extractJob(l.fieldData));

    overallMap.set(camp, (overallMap.get(camp) ?? 0) + 1);

    const cm = cityMap.get(city) ?? new Map<string, number>();
    cm.set(camp, (cm.get(camp) ?? 0) + 1);
    cityMap.set(city, cm);

    const sm = sportMap.get(sport) ?? new Map<string, number>();
    sm.set(camp, (sm.get(camp) ?? 0) + 1);
    sportMap.set(sport, sm);

    if (area) {
      const am = areaMap.get(area) ?? new Map<string, number>();
      am.set(camp, (am.get(camp) ?? 0) + 1);
      areaMap.set(area, am);
    }
    if (job) {
      const jm = jobMap.get(job) ?? new Map<string, number>();
      jm.set(camp, (jm.get(camp) ?? 0) + 1);
      jobMap.set(job, jm);
    }
  }

  let overallBest: string | null = null;
  let overallMax = 0;
  for (const [camp, count] of overallMap) {
    if (count > overallMax) { overallBest = camp; overallMax = count; }
  }

  return {
    byCity: topOf([...cityMap.entries()]),
    bySport: topOf([...sportMap.entries()]),
    byArea: topOf([...areaMap.entries()]),
    byJob: topOf([...jobMap.entries()]),
    overall: overallBest,
  };
}

export type CampaignSummaryRow = { campaignName: string; leadCount: number; metaCampaignId: string | null };

export async function campaignSummaryInRange({ from, to }: Range): Promise<CampaignSummaryRow[]> {
  const leads = await prisma.metaLead.findMany({
    where: leadWindowWhere({ from, to }),
    select: { campaignName: true, campaignId: true },
  });
  const map = new Map<string, { count: number; metaId: string | null }>();
  for (const l of leads) {
    const name = l.campaignName ?? "(unattributed)";
    const e = map.get(name) ?? { count: 0, metaId: l.campaignId };
    e.count += 1;
    map.set(name, e);
  }
  return [...map.entries()]
    .map(([campaignName, v]) => ({ campaignName, leadCount: v.count, metaCampaignId: v.metaId }))
    .sort((a, b) => b.leadCount - a.leadCount);
}

// Top campaign per sales-data dimension (b2bB2c, sport, timeline).
export type SalesTopCampaignMap = {
  byB2bB2c: Record<string, string>;
  bySport: Record<string, string>;
  byTimeline: Record<string, string>;
};

export async function salesTopCampaignPerDimension(range: Range): Promise<SalesTopCampaignMap> {
  const leads = await (prisma.metaLead as any).findMany({
    where: leadWindowWhere(range),
    select: { salesData: true, campaignName: true },
  }) as { salesData?: string | null; campaignName?: string | null }[];

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

  const b2bMap = new Map<string, Map<string, number>>();
  const sportMap = new Map<string, Map<string, number>>();
  const tlMap = new Map<string, Map<string, number>>();

  for (const l of leads) {
    const s = parseSales(l.salesData ?? null);
    if (!s) continue;
    const camp = l.campaignName ?? "(unattributed)";

    const b2b = s.b2bB2c?.trim();
    if (b2b) {
      const m = b2bMap.get(b2b) ?? new Map<string, number>();
      m.set(camp, (m.get(camp) ?? 0) + 1);
      b2bMap.set(b2b, m);
    }
    const sport = normalizeLabel(s.sport);
    if (sport) {
      const m = sportMap.get(sport) ?? new Map<string, number>();
      m.set(camp, (m.get(camp) ?? 0) + 1);
      sportMap.set(sport, m);
    }
    const tl = s.timeline?.trim();
    if (tl) {
      const m = tlMap.get(tl) ?? new Map<string, number>();
      m.set(camp, (m.get(camp) ?? 0) + 1);
      tlMap.set(tl, m);
    }
  }

  return {
    byB2bB2c: topOf([...b2bMap.entries()]),
    bySport: topOf([...sportMap.entries()]),
    byTimeline: topOf([...tlMap.entries()]),
  };
}
