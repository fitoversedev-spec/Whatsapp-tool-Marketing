// Ads-side Meta config: the system-user token + ad account id + page id used by
// the Marketing API client. This is a SEPARATE credential from the WhatsApp/WABA
// token (see src/lib/token-manager.ts). Stored in the `settings` table (keys
// below) with env fallback so the .env-based setup keeps working until seeded.
//
// NEVER use getMetaAccessToken() for ads calls — that returns the WhatsApp token.

import { prisma } from "@/lib/prisma";

const KEY_TOKEN = "meta_ads_system_user_token";
const KEY_AD_ACCOUNT_ID = "meta_ad_account_id";
const KEY_PAGE_ID = "meta_page_id";

export type MetaAdsConfig = {
  token: string;
  adAccountId: string; // normalized WITHOUT the leading "act_"; the URL builder re-adds it
  pageId: string;
};

// Strip any leading "act_" so callers can always assume a bare numeric id.
function normalizeAdAccountId(raw: string): string {
  return raw.replace(/^act_/, "");
}

export async function getMetaAdsConfig(): Promise<MetaAdsConfig> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [KEY_TOKEN, KEY_AD_ACCOUNT_ID, KEY_PAGE_ID] } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const token = byKey.get(KEY_TOKEN) || process.env.META_ADS_TOKEN || "";
  const adAccountIdRaw = byKey.get(KEY_AD_ACCOUNT_ID) || process.env.META_AD_ACCOUNT_ID || "";
  const pageId = byKey.get(KEY_PAGE_ID) || process.env.META_PAGE_ID || "";

  return {
    token,
    adAccountId: normalizeAdAccountId(adAccountIdRaw),
    pageId,
  };
}

export async function setMetaAdsConfig(partial: {
  token?: string;
  adAccountId?: string;
  pageId?: string;
}): Promise<void> {
  const writes: Promise<unknown>[] = [];

  const upsert = (key: string, value: string) => {
    writes.push(
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    );
  };

  if (partial.token !== undefined) upsert(KEY_TOKEN, partial.token);
  if (partial.adAccountId !== undefined) upsert(KEY_AD_ACCOUNT_ID, partial.adAccountId);
  if (partial.pageId !== undefined) upsert(KEY_PAGE_ID, partial.pageId);

  await Promise.all(writes);
}

export async function metaAdsConfigured(): Promise<boolean> {
  const { token, adAccountId } = await getMetaAdsConfig();
  return !!token && !!adAccountId;
}
