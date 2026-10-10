// Server-side read helpers for the "Ad Campaigns" UI area (Phase 5).
// Reads the Phase 1 ingest tables (AdInsight joined to MetaCampaign, and
// MetaLead) and returns plain, JSON-serializable objects the page can hand
// straight to the client component — no Prisma Decimal/Date instances leak
// out (Decimals -> Number, Dates -> ISO strings), matching how the other
// analytics read libs (e.g. src/lib/analytics/invoices.ts) serialize.
//
// CTR is returned as a FRACTION (0..1) so it feeds fmtPct() directly. Cost
// per lead is plain rupees (there is no fmtCpl — the UI formats it with
// fmtInr). The per-campaign roll-ups use prisma groupBy/_sum so the database
// does the adding instead of loading every insight / lead row into memory.

import { prisma } from "@/lib/prisma";
import { fetchAdNames } from "./client";
import { extractArea, extractStartTime } from "./fieldMap";

export type AdCampaignKpis = {
  totalSpend: number; // rupees
  totalLeads: number;
  avgCpl: number | null; // rupees per lead = totalSpend / totalLeads
  avgCtr: number | null; // FRACTION 0..1 = totalClicks / totalImpressions
  totalImpressions: number;
  totalClicks: number;
  totalReach: number;
  campaignCount: number;
};

export type AdCampaignRow = {
  campaignId: string; // internal MetaCampaign.id
  metaId: string; // raw Meta campaign id
  name: string;
  objective: string | null;
  status: string | null;
  spend: number; // rupees
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  cpl: number | null; // rupees per lead
  ctr: number | null; // FRACTION 0..1
};

export type AdCampaignOverview = {
  kpis: AdCampaignKpis;
  campaigns: AdCampaignRow[];
};

// KPI roll-up + per-campaign breakdown from AdInsight over [from, to].
// The window is inclusive on both ends (the page's parseDateParam sets the
// upper bound to 23:59:59, matching the analytics routes' convention).
export async function getAdCampaignOverview({ from, to }: { from: Date; to: Date }): Promise<AdCampaignOverview> {
  const where = { date: { gte: from, lte: to } };
  // One grouped sum per campaign instead of loading every daily insight row.
  const [sums, campaignRows] = await Promise.all([
    prisma.adInsight.groupBy({
      by: ["campaignId"],
      where,
      _sum: { spend: true, impressions: true, reach: true, clicks: true, leads: true },
    }),
    prisma.metaCampaign.findMany({
      where: { insights: { some: where } },
      select: { id: true, metaId: true, name: true, objective: true, status: true },
    }),
  ]);
  const campaignById = new Map(campaignRows.map((c) => [c.id, c]));

  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalLeads = 0;
  // Reach isn't strictly additive across days (a person reached on two days is
  // one unique reach), so the summed value is an upper-bound approximation —
  // fine for a headline figure, and the only reach we have per-day.
  let totalReach = 0;

  const campaigns: AdCampaignRow[] = [];
  for (const g of sums) {
    const c = campaignById.get(g.campaignId);
    if (!c) continue;
    const spend = Number(g._sum.spend ?? 0);
    const impressions = g._sum.impressions ?? 0;
    const reach = g._sum.reach ?? 0;
    const clicks = g._sum.clicks ?? 0;
    const leads = g._sum.leads ?? 0;
    totalSpend += spend;
    totalImpressions += impressions;
    totalClicks += clicks;
    totalLeads += leads;
    totalReach += reach;
    campaigns.push({
      campaignId: c.id,
      metaId: c.metaId,
      name: c.name,
      objective: c.objective,
      status: c.status,
      spend: Math.round(spend),
      impressions,
      reach,
      clicks,
      leads,
      cpl: leads > 0 ? spend / leads : null,
      ctr: impressions > 0 ? clicks / impressions : null,
    });
  }
  campaigns.sort((a, b) => b.spend - a.spend);

  return {
    kpis: {
      totalSpend: Math.round(totalSpend),
      totalLeads,
      avgCpl: totalLeads > 0 ? totalSpend / totalLeads : null,
      avgCtr: totalImpressions > 0 ? totalClicks / totalImpressions : null,
      totalImpressions,
      totalClicks,
      totalReach,
      campaignCount: campaigns.length,
    },
    campaigns,
  };
}

export type MetaLeadRow = {
  id: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  formName: string | null;
  campaignName: string | null;
  city: string | null; // extracted at ingest from the form's city question
  sport: string | null; // extracted at ingest from the form's sport question
  area: string | null; // extracted at ingest from the form's area/dimensions question
  startTime: string | null; // "When are you planning to start?" answer as a tidy label (derived server-side from fieldData)
  stage: string; // lead pipeline stage (NEW|CONTACTED|QUALIFIED|CONVERTED|LOST); shown + filtered in the list
  labels: { id: string; name: string; color: string }[]; // applied label chips (for the list view)
  assignedToName: string | null;
  inCrm: boolean; // MetaLead.accountContactId != null (linked to a CRM AccountContact on move-to-CRM)
  capturedAt: string; // ISO — createdAtMeta (Meta's submit time) when present, else the ingest time
};

// Columns selected for a MetaLeadRow, shared by every lead-list query so the
// serialization stays identical (Decimal/Date never leak; inCrm derives from
// accountContactId — the live CRM link — not the deprecated leadId mirror).
// fieldData is read only to derive startTime / the area fallback; it never
// reaches a MetaLeadRow (the detail view adds it back explicitly).
export const META_LEAD_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  formName: true,
  campaignName: true,
  city: true,
  sport: true,
  area: true,
  fieldData: true,
  stage: true,
  accountContactId: true,
  createdAtMeta: true,
  createdAt: true,
  assignedTo: { select: { name: true } },
  labels: {
    select: { label: { select: { id: true, name: true, color: true } } },
    orderBy: { labeledAt: "asc" as const },
  },
} as const;

export type MetaLeadSelected = {
  id: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  formName: string | null;
  campaignName: string | null;
  city: string | null;
  sport: string | null;
  area: string | null;
  fieldData: string;
  stage: string;
  assignedTo: { name: string } | null;
  accountContactId: string | null;
  createdAtMeta: Date | null;
  createdAt: Date;
  labels: { label: { id: string; name: string; color: string } }[];
};

// Area as shown in the list: the stored column, else (older rows ingested before
// the column existed) the answer found in the form data.
export function deriveArea(area: string | null, fieldData: string | null | undefined): string | null {
  if (area || !fieldData) return area;
  try {
    const fd = JSON.parse(fieldData);
    if (Array.isArray(fd)) return extractArea(fd);
  } catch {}
  return area;
}

export function toMetaLeadRow(l: MetaLeadSelected): MetaLeadRow {
  return {
    id: l.id,
    fullName: l.fullName,
    phone: l.phone,
    email: l.email,
    formName: l.formName,
    campaignName: l.campaignName,
    city: l.city,
    sport: l.sport,
    area: deriveArea(l.area, l.fieldData),
    startTime: extractStartTime(l.fieldData),
    stage: l.stage,
    labels: l.labels.map((j) => j.label),
    assignedToName: l.assignedTo?.name ?? null,
    inCrm: l.accountContactId != null,
    capturedAt: (l.createdAtMeta ?? l.createdAt).toISOString(),
  };
}

// A lead falls in [from, to] by its Meta submit time (createdAtMeta) when
// present, else its ingest time (createdAt) — so a lead that arrived without a
// Meta timestamp is still windowed rather than silently dropped.
export function leadWindowWhere({ from, to }: { from: Date; to: Date }) {
  return {
    OR: [
      { createdAtMeta: { gte: from, lte: to } },
      { createdAtMeta: null, createdAt: { gte: from, lte: to } },
    ],
  };
}

// One captured MetaLead by its internal id (MetaLead.id, NOT the raw Meta
// leadgen id) for the dedicated lead detail page. Same MetaLeadRow shape as the
// list queries; returns null when no such lead exists.
export async function getMetaLeadById(id: string): Promise<MetaLeadRow | null> {
  const lead = await prisma.metaLead.findUnique({ where: { id }, select: META_LEAD_SELECT });
  return lead ? toMetaLeadRow(lead) : null;
}

// The lead-management fields shown in the detail-page sidebar. A superset of
// MetaLeadRow (so it stays compatible with MoveToCrmDialog, which only reads
// lead.id) plus stage/assignee/reminder and the labels + notes relations. Only
// the detail page loads these — the list queries stay lean (META_LEAD_SELECT).
export type MetaLeadLabelChip = { id: string; name: string; color: string };
export type MetaLeadNoteRow = {
  id: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
};
export type MetaLeadReminderRow = {
  id: string;
  message: string;
  dueAt: string;
  status: string;
  completedAt: string | null;
};

export type MetaLeadDetail = MetaLeadRow & {
  fieldData: string; // raw JSON string of all form answers — the detail view parses it defensively
  // stage is inherited from MetaLeadRow.
  reminderAt: string | null; // ISO, or null = "No reminder" (legacy scalar)
  assignedToUserId: string | null;
  assignedToName: string | null;
  labels: MetaLeadLabelChip[];
  notes: MetaLeadNoteRow[]; // newest first
  salesData: string | null; // JSON: sales follow-up form data
  reminders: MetaLeadReminderRow[];
};

// One captured MetaLead with its full lead-management payload, for the detail
// page. Returns null when no such lead exists.
export async function getMetaLeadDetail(id: string): Promise<MetaLeadDetail | null> {
  const lead = await (prisma.metaLead as any).findUnique({
    where: { id },
    select: {
      ...META_LEAD_SELECT,
      reminderAt: true,
      assignedToUserId: true,
      salesData: true,
      assignedTo: { select: { name: true } },
      labels: {
        select: { label: { select: { id: true, name: true, color: true } } },
        orderBy: { labeledAt: "asc" },
      },
      notes: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          body: true,
          createdAt: true,
          authorUserId: true,
          author: { select: { name: true } },
        },
      },
      reminders: {
        orderBy: { dueAt: "asc" },
        select: {
          id: true,
          message: true,
          dueAt: true,
          status: true,
          completedAt: true,
        },
      },
    },
  }) as any;
  if (!lead) return null;

  return {
    ...toMetaLeadRow(lead),
    fieldData: lead.fieldData,
    reminderAt: lead.reminderAt ? lead.reminderAt.toISOString() : null,
    assignedToUserId: lead.assignedToUserId,
    assignedToName: lead.assignedTo?.name ?? null,
    salesData: lead.salesData ?? null,
    labels: lead.labels.map((l: any) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
    notes: lead.notes.map((n: any) => ({
      id: n.id,
      authorUserId: n.authorUserId,
      authorName: n.author?.name ?? "—",
      body: n.body,
      createdAt: n.createdAt.toISOString(),
    })),
    reminders: (lead.reminders ?? []).map((r: any) => ({
      id: r.id,
      message: r.message,
      dueAt: r.dueAt.toISOString(),
      status: r.status,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    })),
  };
}

// The full label catalogue (for the sidebar's label picker), alphabetical.
export async function getMetaLeadLabels(): Promise<MetaLeadLabelChip[]> {
  return prisma.metaLeadLabel.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true },
  });
}

export async function getMetaLeadStages() {
  return prisma.metaLeadStage.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, slug: true, name: true, colorHex: true, isDefault: true },
  });
}

// ---------------------------------------------------------------------------
// Campaign-centric reads (the "Campaigns" drill-down list + detail).
// ---------------------------------------------------------------------------

// One row of the all-campaigns list. Rolls up every AdInsight day the campaign
// has (NOT windowed — this is the lifetime view so a paused / no-spend campaign
// still appears). Two lead numbers, deliberately separate:
//   • insightLeads  — the Insights KPI (AdInsight.leads), Meta's own count.
//   • capturedLeads — count(MetaLead) rows we actually ingested for this
//                     campaign (joined on the RAW Meta id, MetaLead.campaignId
//                     = MetaCampaign.metaId).
export type CampaignListRow = {
  metaId: string; // raw Meta campaign id
  name: string;
  status: string | null;
  objective: string | null;
  sport: string | null;
  spend: number; // rupees
  impressions: number;
  clicks: number;
  insightLeads: number; // AdInsight.leads KPI
  capturedLeads: number; // count(MetaLead where campaignId = metaId)
  cpl: number | null; // rupees per insight lead
  ctr: number | null; // FRACTION 0..1
  lastRanAt: string | null; // YYYY-MM-DD of the latest day with spend > 0 in the window; null = never ran
};

// ALL campaigns (active, paused, archived, zero-spend). When a date range is
// provided, insights and captured leads are windowed to that range and campaigns
// with zero activity are excluded so only relevant campaigns show.
export async function getCampaignList(range?: { from: Date; to: Date }): Promise<CampaignListRow[]> {
  const insightWhere = range ? { date: { gte: range.from, lte: range.to } } : {};
  const leadWhere = range
    ? { campaignId: { not: null }, ...leadWindowWhere(range) }
    : { campaignId: { not: null as any } };
  // Grouped sums / counts instead of loading every insight and lead row.
  const [campaigns, insightSums, lastRan, leadCounts] = await Promise.all([
    prisma.metaCampaign.findMany({
      select: { id: true, metaId: true, name: true, status: true, objective: true, sport: true, createdAtMeta: true },
    }),
    prisma.adInsight.groupBy({
      by: ["campaignId"],
      where: insightWhere,
      _sum: { spend: true, impressions: true, clicks: true, leads: true },
    }),
    // Latest day each campaign actually spent money (within the window).
    prisma.adInsight.groupBy({
      by: ["campaignId"],
      where: { ...insightWhere, spend: { gt: 0 } },
      _max: { date: true },
    }),
    prisma.metaLead.groupBy({ by: ["campaignId"], where: leadWhere, _count: { _all: true } }),
  ]);

  const sumsById = new Map(insightSums.map((g) => [g.campaignId, g._sum]));
  const lastRanById = new Map(lastRan.map((g) => [g.campaignId, g._max.date]));
  const createdByMetaId = new Map(campaigns.map((c) => [c.metaId, c.createdAtMeta?.getTime() ?? 0]));
  const capturedByMetaId = new Map<string, number>();
  for (const g of leadCounts) {
    if (g.campaignId) capturedByMetaId.set(g.campaignId, g._count._all);
  }

  return campaigns
    .map((c) => {
      const sums = sumsById.get(c.id);
      const spend = Number(sums?.spend ?? 0);
      const impressions = sums?.impressions ?? 0;
      const clicks = sums?.clicks ?? 0;
      const insightLeads = sums?.leads ?? 0;
      return {
        metaId: c.metaId,
        name: c.name,
        status: c.status,
        objective: c.objective,
        sport: c.sport,
        spend: Math.round(spend),
        impressions,
        clicks,
        insightLeads,
        capturedLeads: capturedByMetaId.get(c.metaId) ?? 0,
        cpl: insightLeads > 0 ? spend / insightLeads : null,
        ctr: impressions > 0 ? clicks / impressions : null,
        lastRanAt: lastRanById.get(c.id)?.toISOString().slice(0, 10) ?? null,
      };
    })
    .filter((c) => !range || c.spend > 0 || c.insightLeads > 0 || c.capturedLeads > 0)
    // Default order: most recently ran first (ties: higher spend); campaigns that
    // never ran go last, newest-created first.
    .sort((a, b) => {
      if (a.lastRanAt && b.lastRanAt) {
        return a.lastRanAt < b.lastRanAt ? 1 : a.lastRanAt > b.lastRanAt ? -1 : b.spend - a.spend;
      }
      if (a.lastRanAt) return -1;
      if (b.lastRanAt) return 1;
      return (createdByMetaId.get(b.metaId) ?? 0) - (createdByMetaId.get(a.metaId) ?? 0);
    });
}

// A single point on a campaign's per-day trend line.
export type CampaignDayPoint = {
  date: string; // YYYY-MM-DD (date-only semantics of AdInsight.date)
  spend: number; // rupees
  impressions: number;
  clicks: number;
  leads: number; // Insights KPI for the day
};

export type CampaignDetail = {
  metaId: string;
  name: string;
  status: string | null;
  objective: string | null;
  sport: string | null;
  spend: number; // rupees
  impressions: number;
  reach: number; // summed per-day (upper-bound approximation of unique reach)
  clicks: number;
  insightLeads: number; // AdInsight.leads KPI over the window
  capturedLeads: number; // count(MetaLead where campaignId = metaId) over the window
  cpl: number | null; // rupees per insight lead
  ctr: number | null; // FRACTION 0..1
  series: CampaignDayPoint[]; // per-day, ascending by date
};

// One campaign by its RAW Meta id, with its AdInsight rollup + per-day trend
// over an optional window. Returns null if no such campaign exists.
export async function getCampaignById(
  metaId: string,
  range?: { from: Date; to: Date }
): Promise<CampaignDetail | null> {
  const campaign = await prisma.metaCampaign.findUnique({
    where: { metaId },
    select: { metaId: true, name: true, status: true, objective: true, sport: true },
  });
  if (!campaign) return null;

  const [insights, capturedLeads] = await Promise.all([
    prisma.adInsight.findMany({
      where: {
        campaign: { metaId },
        ...(range ? { date: { gte: range.from, lte: range.to } } : {}),
      },
      orderBy: { date: "asc" },
      select: { date: true, spend: true, impressions: true, reach: true, clicks: true, leads: true },
    }),
    prisma.metaLead.count({
      where: { campaignId: metaId, ...(range ? leadWindowWhere(range) : {}) },
    }),
  ]);

  let spend = 0;
  let impressions = 0;
  let reach = 0;
  let clicks = 0;
  let insightLeads = 0;
  const series: CampaignDayPoint[] = insights.map((i) => {
    const daySpend = Number(i.spend);
    spend += daySpend;
    impressions += i.impressions;
    reach += i.reach;
    clicks += i.clicks;
    insightLeads += i.leads;
    return {
      date: i.date.toISOString().slice(0, 10),
      spend: Math.round(daySpend),
      impressions: i.impressions,
      clicks: i.clicks,
      leads: i.leads,
    };
  });

  return {
    metaId: campaign.metaId,
    name: campaign.name,
    status: campaign.status,
    objective: campaign.objective,
    sport: campaign.sport,
    spend: Math.round(spend),
    impressions,
    reach,
    clicks,
    insightLeads,
    capturedLeads,
    cpl: insightLeads > 0 ? spend / insightLeads : null,
    ctr: impressions > 0 ? clicks / impressions : null,
    series,
  };
}

// Active/approved users for the move-to-CRM owner picker. Same active/approved/
// not-deleted where-clause every user-listing query in the app uses (mirrors
// src/app/api/users/assignable/route.ts).
export async function getAssignableReps(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({
    where: { deletedAt: null, isActive: true, approvalStatus: "approved" },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

// Ad-level lead breakdown for one campaign: which AD produced the most leads
// (most → least), each with the city distribution of those leads. Ad NAMES are
// resolved from Meta on demand (fetchAdNames, SU token) and fall back to the raw
// id when unavailable. Grouping is done in JS (findMany + reduce), same pattern
// as the other reads here. Leads with no ad_id fall into an "organic" bucket.
export type AdLeadBreakdownRow = {
  adId: string | null;
  adName: string;
  leadCount: number;
  cities: { city: string; count: number }[]; // desc by count
};

export async function getAdLeadBreakdown(
  metaId: string,
  range?: { from: Date; to: Date }
): Promise<AdLeadBreakdownRow[]> {
  const leads = await prisma.metaLead.findMany({
    where: { campaignId: metaId, ...(range ? leadWindowWhere(range) : {}) },
    select: { adId: true, city: true },
  });

  const NONE = "__none__";
  const byAd = new Map<string, { adId: string | null; count: number; cities: Map<string, number> }>();
  for (const l of leads) {
    const key = l.adId ?? NONE;
    let g = byAd.get(key);
    if (!g) {
      g = { adId: l.adId ?? null, count: 0, cities: new Map() };
      byAd.set(key, g);
    }
    g.count += 1;
    const city = (l.city ?? "").trim() || "—";
    g.cities.set(city, (g.cities.get(city) ?? 0) + 1);
  }

  const adIds = [...byAd.values()].map((g) => g.adId).filter((x): x is string => !!x);
  let names = new Map<string, string>();
  try {
    names = await fetchAdNames(adIds);
  } catch {
    /* ad names are cosmetic — fall back to the raw id below */
  }

  return [...byAd.values()]
    .map((g) => ({
      adId: g.adId,
      adName: g.adId ? names.get(g.adId) ?? `Ad ${g.adId}` : "(no ad / organic)",
      leadCount: g.count,
      cities: [...g.cities.entries()]
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city)),
    }))
    .sort((a, b) => b.leadCount - a.leadCount);
}
