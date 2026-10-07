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

// The sweep also runs from every logged-in browser's 5-minute tick
// (src/components/CronTick.tsx), so without a shared gate the full Meta sync
// ran once per open browser. One run per ~5 minutes for the whole team: whoever
// moves this timestamp forward runs it, everyone else skips. 30 s of slack so a
// tick landing at 4:59 doesn't push the next run out to 10 minutes.
const SYNC_EVERY_MS = 5 * 60 * 1000 - 30_000;
const KEY_LAST_SYNC = "meta_ads_insights_synced_at";

async function claimSyncSlot(): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - SYNC_EVERY_MS).toISOString();
  // Atomic: only one concurrent sweep can move an old timestamp forward.
  // (ISO-8601 UTC strings compare correctly as text.)
  const claimed = await prisma.setting.updateMany({
    where: { key: KEY_LAST_SYNC, value: { lt: cutoff } },
    data: { value: now.toISOString() },
  });
  if (claimed.count === 1) return true;
  if (await prisma.setting.findUnique({ where: { key: KEY_LAST_SYNC } })) return false;
  try {
    // Very first run — a concurrent creator loses on the primary key.
    await prisma.setting.create({ data: { key: KEY_LAST_SYNC, value: now.toISOString() } });
    return true;
  } catch {
    return false;
  }
}

export async function syncAdsInsights(): Promise<
  { campaigns: number; days: number } | { skipped: string }
> {
  try {
    // Gate inside the try so the config DB read is subject to the same no-throw
    // swallow as the rest of the body (honours the "NEVER throws" contract).
    if (!(await metaAdsConfigured())) return { skipped: "ads_not_configured" };
    if (!(await claimSyncSlot())) return { skipped: "synced_recently" };

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
