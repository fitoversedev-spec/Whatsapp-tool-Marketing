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
  for (const f of parseFieldDataJson(fieldDataJson)) {
    const name = (f.name ?? "").toLowerCase().trim();
    if (!name) continue;
    if (JOB_ALIASES.some((a) => name.includes(a))) {
      const v = f.value?.trim();
      if (v) return v;
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

// Flat job x city x sport cross-tab (one cell per non-empty combination), so
// the UI can show "what job, from what city, wanting what sport" in one place
// and filter on any of the three. Job comes from the form answers (extractJob);
// city/sport from their columns. Blank values -> "Unknown". Sorted count desc.
export async function jobAnalytics({ from, to }: Range): Promise<JobCityCell[]> {
  const leads = await prisma.metaLead.findMany({
    where: leadWindowWhere({ from, to }),
    select: { city: true, sport: true, fieldData: true },
  });

  const map = new Map<string, JobCityCell>();
  for (const l of leads) {
    const job = normalizeLabel(extractJob(l.fieldData)) ?? UNKNOWN;
    const city = normalizeLabel(l.city) ?? UNKNOWN;
    const sport = normalizeLabel(l.sport) ?? UNKNOWN;
    const key = `${job}||${city}||${sport}`;
    const e = map.get(key) ?? { job, city, sport, count: 0 };
    e.count += 1;
    map.set(key, e);
  }

  return [...map.values()].sort((a, b) => b.count - a.count || a.job.localeCompare(b.job));
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
