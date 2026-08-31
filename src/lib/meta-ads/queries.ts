// Server-side read helpers for the "Ad Campaigns" UI area (Phase 5).
// Reads the Phase 1 ingest tables (AdInsight joined to MetaCampaign, and
// MetaLead) and returns plain, JSON-serializable objects the page can hand
// straight to the client component — no Prisma Decimal/Date instances leak
// out (Decimals -> Number, Dates -> ISO strings), matching how the other
// analytics read libs (e.g. src/lib/analytics/invoices.ts) serialize.
//
// CTR is returned as a FRACTION (0..1) so it feeds fmtPct() directly. Cost
// per lead is plain rupees (there is no fmtCpl — the UI formats it with
// fmtInr). All aggregation is done in JS (findMany + reduce), the same
// pattern invoices.ts uses, rather than prisma groupBy.

import { prisma } from "@/lib/prisma";
import { fetchAdNames } from "./client";

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
  const insights = await prisma.adInsight.findMany({
    where: { date: { gte: from, lte: to } },
    select: {
      campaignId: true,
      spend: true,
      impressions: true,
      reach: true,
      clicks: true,
      leads: true,
      campaign: { select: { metaId: true, name: true, objective: true, status: true } },
    },
  });

  type Acc = {
    campaignId: string;
    metaId: string;
    name: string;
    objective: string | null;
    status: string | null;
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    leads: number;
  };
  const byCampaign = new Map<string, Acc>();

  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalLeads = 0;
  // Reach isn't strictly additive across days (a person reached on two days is
  // one unique reach), so the summed value is an upper-bound approximation —
  // fine for a headline figure, and the only reach we have per-day.
  let totalReach = 0;

  for (const row of insights) {
    const spend = Number(row.spend);
    totalSpend += spend;
    totalImpressions += row.impressions;
    totalClicks += row.clicks;
    totalLeads += row.leads;
    totalReach += row.reach;

    const acc =
      byCampaign.get(row.campaignId) ?? {
        campaignId: row.campaignId,
        metaId: row.campaign.metaId,
        name: row.campaign.name,
        objective: row.campaign.objective,
        status: row.campaign.status,
        spend: 0,
        impressions: 0,
        reach: 0,
        clicks: 0,
        leads: 0,
      };
    acc.spend += spend;
    acc.impressions += row.impressions;
    acc.reach += row.reach;
    acc.clicks += row.clicks;
    acc.leads += row.leads;
    byCampaign.set(row.campaignId, acc);
  }

  const campaigns: AdCampaignRow[] = [...byCampaign.values()]
    .map((c) => ({
      campaignId: c.campaignId,
      metaId: c.metaId,
      name: c.name,
      objective: c.objective,
      status: c.status,
      spend: Math.round(c.spend),
      impressions: c.impressions,
      reach: c.reach,
      clicks: c.clicks,
      leads: c.leads,
      cpl: c.leads > 0 ? c.spend / c.leads : null,
      ctr: c.impressions > 0 ? c.clicks / c.impressions : null,
    }))
    .sort((a, b) => b.spend - a.spend);

  return {
    kpis: {
      totalSpend: Math.round(totalSpend),
      totalLeads,
      avgCpl: totalLeads > 0 ? totalSpend / totalLeads : null,
      avgCtr: totalImpressions > 0 ? totalClicks / totalImpressions : null,
      totalImpressions,
      totalClicks,
      totalReach,
      campaignCount: byCampaign.size,
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
  fieldData: string; // raw JSON string of all form answers — client parses defensively
  stage: string; // lead pipeline stage (NEW|CONTACTED|QUALIFIED|CONVERTED|LOST); shown + filtered in the list
  labels: { id: string; name: string; color: string }[]; // applied label chips (for the list view)
  inCrm: boolean; // MetaLead.accountContactId != null (linked to a CRM AccountContact on move-to-CRM)
  capturedAt: string; // ISO — createdAtMeta (Meta's submit time) when present, else the ingest time
};

// Columns selected for a MetaLeadRow, shared by every lead-list query so the
// serialization stays identical (Decimal/Date never leak; inCrm derives from
// accountContactId — the live CRM link — not the deprecated leadId mirror).
const META_LEAD_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  formName: true,
  campaignName: true,
  city: true,
  sport: true,
  fieldData: true,
  stage: true,
  accountContactId: true,
  createdAtMeta: true,
  createdAt: true,
  labels: {
    select: { label: { select: { id: true, name: true, color: true } } },
    orderBy: { labeledAt: "asc" as const },
  },
} as const;

type MetaLeadSelected = {
  id: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  formName: string | null;
  campaignName: string | null;
  city: string | null;
  sport: string | null;
  fieldData: string;
  stage: string;
  accountContactId: string | null;
  createdAtMeta: Date | null;
  createdAt: Date;
  labels: { label: { id: string; name: string; color: string } }[];
};

function toMetaLeadRow(l: MetaLeadSelected): MetaLeadRow {
  return {
    id: l.id,
    fullName: l.fullName,
    phone: l.phone,
    email: l.email,
    formName: l.formName,
    campaignName: l.campaignName,
    city: l.city,
    sport: l.sport,
    fieldData: l.fieldData,
    stage: l.stage,
    labels: l.labels.map((j) => j.label),
    inCrm: l.accountContactId != null,
    capturedAt: (l.createdAtMeta ?? l.createdAt).toISOString(),
  };
}

// A lead falls in [from, to] by its Meta submit time (createdAtMeta) when
// present, else its ingest time (createdAt) — so a lead that arrived without a
// Meta timestamp is still windowed rather than silently dropped.
function leadWindowWhere({ from, to }: { from: Date; to: Date }) {
  return {
    OR: [
      { createdAtMeta: { gte: from, lte: to } },
      { createdAtMeta: null, createdAt: { gte: from, lte: to } },
    ],
  };
}

// MetaLead list over [from, to].
export async function getMetaLeads({ from, to }: { from: Date; to: Date }): Promise<MetaLeadRow[]> {
  const leads = await prisma.metaLead.findMany({
    where: leadWindowWhere({ from, to }),
    orderBy: [{ createdAtMeta: "desc" }, { createdAt: "desc" }],
    select: META_LEAD_SELECT,
  });

  return leads.map(toMetaLeadRow);
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
export type MetaLeadDetail = MetaLeadRow & {
  // stage is inherited from MetaLeadRow.
  reminderAt: string | null; // ISO, or null = "No reminder"
  assignedToUserId: string | null;
  assignedToName: string | null;
  labels: MetaLeadLabelChip[];
  notes: MetaLeadNoteRow[]; // newest first
  salesData: string | null; // JSON: sales follow-up form data
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
    },
  }) as any;
  if (!lead) return null;

  return {
    ...toMetaLeadRow(lead),
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
  };
}

// The full label catalogue (for the sidebar's label picker), alphabetical.
export async function getMetaLeadLabels(): Promise<MetaLeadLabelChip[]> {
  return prisma.metaLeadLabel.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true },
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
  spend: number; // rupees
  impressions: number;
  clicks: number;
  insightLeads: number; // AdInsight.leads KPI
  capturedLeads: number; // count(MetaLead where campaignId = metaId)
  cpl: number | null; // rupees per insight lead
  ctr: number | null; // FRACTION 0..1
};

const isActiveStatus = (s: string | null | undefined) => (s ?? "").toUpperCase() === "ACTIVE";

// ALL campaigns (active, paused, archived, zero-spend) — never gated on the
// existence of AdInsight rows. Sorted active-first, then by spend desc.
export async function getCampaignList(): Promise<CampaignListRow[]> {
  const [campaigns, leads] = await Promise.all([
    prisma.metaCampaign.findMany({
      select: {
        metaId: true,
        name: true,
        status: true,
        objective: true,
        insights: { select: { spend: true, impressions: true, clicks: true, leads: true } },
      },
    }),
    // Captured-lead counts joined on the RAW Meta id — tallied in JS (never groupBy).
    prisma.metaLead.findMany({ where: { campaignId: { not: null } }, select: { campaignId: true } }),
  ]);

  const capturedByMetaId = new Map<string, number>();
  for (const l of leads) {
    if (!l.campaignId) continue;
    capturedByMetaId.set(l.campaignId, (capturedByMetaId.get(l.campaignId) ?? 0) + 1);
  }

  return campaigns
    .map((c) => {
      let spend = 0;
      let impressions = 0;
      let clicks = 0;
      let insightLeads = 0;
      for (const i of c.insights) {
        spend += Number(i.spend);
        impressions += i.impressions;
        clicks += i.clicks;
        insightLeads += i.leads;
      }
      return {
        metaId: c.metaId,
        name: c.name,
        status: c.status,
        objective: c.objective,
        spend: Math.round(spend),
        impressions,
        clicks,
        insightLeads,
        capturedLeads: capturedByMetaId.get(c.metaId) ?? 0,
        cpl: insightLeads > 0 ? spend / insightLeads : null,
        ctr: impressions > 0 ? clicks / impressions : null,
      };
    })
    .sort((a, b) => {
      const aa = isActiveStatus(a.status) ? 0 : 1;
      const bb = isActiveStatus(b.status) ? 0 : 1;
      return aa - bb || b.spend - a.spend;
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
    select: { metaId: true, name: true, status: true, objective: true },
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

// The captured MetaLeads for one campaign (RAW Meta id join), newest first,
// optionally windowed. Same MetaLeadRow shape as getMetaLeads.
export async function getLeadsForCampaign(
  metaId: string,
  range?: { from: Date; to: Date }
): Promise<MetaLeadRow[]> {
  const leads = await prisma.metaLead.findMany({
    where: { campaignId: metaId, ...(range ? leadWindowWhere(range) : {}) },
    orderBy: [{ createdAtMeta: "desc" }, { createdAt: "desc" }],
    select: META_LEAD_SELECT,
  });
  return leads.map(toMetaLeadRow);
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
