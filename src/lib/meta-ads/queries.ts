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
  fieldData: string; // raw JSON string of all form answers — client parses defensively
  inCrm: boolean; // MetaLead.leadId != null (mirrored into a CRM Lead in a later phase)
  capturedAt: string; // ISO — createdAtMeta (Meta's submit time) when present, else the ingest time
};

// MetaLead list over [from, to]. Filters on the lead's Meta submit time
// (createdAtMeta) when present, falling back to the ingest time (createdAt)
// for any lead that arrived without a Meta timestamp, so no captured lead is
// silently dropped from the window.
export async function getMetaLeads({ from, to }: { from: Date; to: Date }): Promise<MetaLeadRow[]> {
  const leads = await prisma.metaLead.findMany({
    where: {
      OR: [
        { createdAtMeta: { gte: from, lte: to } },
        { createdAtMeta: null, createdAt: { gte: from, lte: to } },
      ],
    },
    orderBy: [{ createdAtMeta: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      fullName: true,
      phone: true,
      email: true,
      formName: true,
      campaignName: true,
      fieldData: true,
      leadId: true,
      createdAtMeta: true,
      createdAt: true,
    },
  });

  return leads.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    phone: l.phone,
    email: l.email,
    formName: l.formName,
    campaignName: l.campaignName,
    fieldData: l.fieldData,
    inCrm: l.leadId != null,
    capturedAt: (l.createdAtMeta ?? l.createdAt).toISOString(),
  }));
}
