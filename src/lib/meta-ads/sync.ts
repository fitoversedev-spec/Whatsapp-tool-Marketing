// Ingestion for Meta ad performance: pull campaigns + a rolling window of daily
// insights and upsert them into meta_campaigns / ad_insights. Called from the
// daily cron sweep (src/lib/cron-runner.ts).
//
// Contract: NEVER throws. The gate lives INSIDE the job (early skip) so an
// unconfigured install is a no-op, mirroring runWeeklyDigest's skip pattern.
// Uses the ADS credential path only (metaAdsConfigured / getMetaAdsConfig /
// fetchCampaigns / fetchInsights) — never the WhatsApp/WABA token.

import { prisma } from "@/lib/prisma";
import { getMetaAdsConfig, metaAdsConfigured } from "./config";
import { fetchCampaigns, fetchInsights } from "./client";

// Re-sync the last N days each run so in-flight days (spend/attribution still
// settling) get corrected on subsequent sweeps.
const INSIGHTS_WINDOW_DAYS = 7;

// "YYYY-MM-DD" in UTC — the shape the Graph insights time_range expects and the
// canonical midnight-UTC form we store AdInsight.date in.
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function syncAdsInsights(): Promise<
  { campaigns: number; days: number } | { skipped: string }
> {
  try {
    // Gate inside the try so the config DB read is subject to the same no-throw
    // swallow as the rest of the body (honours the "NEVER throws" contract).
    if (!(await metaAdsConfigured())) return { skipped: "ads_not_configured" };

    const cfg = await getMetaAdsConfig();

    // 1) Campaigns → upsert by metaId, and build a metaId → internal id map so
    //    insights (which carry the raw Meta campaign_id) can resolve to our pk.
    const campaigns = await fetchCampaigns();
    const idByMetaId = new Map<string, string>();
    for (const c of campaigns) {
      const row = await prisma.metaCampaign.upsert({
        where: { metaId: c.id },
        update: {
          name: c.name,
          objective: c.objective ?? null,
          status: c.status ?? null,
          createdAtMeta: c.created_time ? new Date(c.created_time) : null,
        },
        create: {
          metaId: c.id,
          adAccountId: cfg.adAccountId,
          name: c.name,
          objective: c.objective ?? null,
          status: c.status ?? null,
          createdAtMeta: c.created_time ? new Date(c.created_time) : null,
        },
      });
      idByMetaId.set(c.id, row.id);
    }

    // Resolve an insight's raw campaign_id to our internal id, upserting a
    // minimal stub for any campaign that has insights but wasn't in the
    // campaigns edge (e.g. a since-deleted campaign) so we never drop rows.
    const resolveCampaignId = async (metaId: string, name: string): Promise<string> => {
      const hit = idByMetaId.get(metaId);
      if (hit) return hit;
      const row = await prisma.metaCampaign.upsert({
        where: { metaId },
        update: {},
        create: { metaId, adAccountId: cfg.adAccountId, name: name || metaId },
      });
      idByMetaId.set(metaId, row.id);
      return row.id;
    };

    // 2) Insights over the rolling window → upsert per (campaign, date).
    const until = new Date();
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - (INSIGHTS_WINDOW_DAYS - 1));
    const insights = await fetchInsights(ymd(since), ymd(until));

    let days = 0;
    for (const ins of insights) {
      if (!ins.campaignId || !ins.date) continue;
      const date = new Date(ins.date); // "YYYY-MM-DD" → midnight UTC
      if (Number.isNaN(date.getTime())) continue;

      const campaignId = await resolveCampaignId(ins.campaignId, ins.campaignName);
      await prisma.adInsight.upsert({
        where: { campaignId_date: { campaignId, date } },
        update: {
          spend: ins.spend,
          impressions: ins.impressions,
          reach: ins.reach,
          clicks: ins.clicks,
          leads: ins.leads,
          ctr: ins.ctr,
          cpl: ins.cpl,
        },
        create: {
          campaignId,
          date,
          spend: ins.spend,
          impressions: ins.impressions,
          reach: ins.reach,
          clicks: ins.clicks,
          leads: ins.leads,
          ctr: ins.ctr,
          cpl: ins.cpl,
        },
      });
      days += 1;
    }

    return { campaigns: campaigns.length, days };
  } catch (err) {
    console.error("[meta-ads] syncAdsInsights failed", err);
    return { skipped: "error" };
  }
}
