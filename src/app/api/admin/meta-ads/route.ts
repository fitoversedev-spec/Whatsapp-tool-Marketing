// Meta Ads (Marketing API) config API — SEPARATE from /api/admin/meta-token,
// which manages the WhatsApp/WABA token. This one stores the ads system-user
// token + ad account id + page id (see src/lib/meta-ads/config.ts).
//
// GET  /api/admin/meta-ads — returns config PRESENCE (never the token value) plus
//                            a live campaign count as a connectivity health check.
// POST /api/admin/meta-ads — body: { token?, adAccountId?, pageId? } — persists
//                            whichever fields are supplied.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMetaAdsConfig, setMetaAdsConfig } from "@/lib/meta-ads/config";
import { fetchCampaigns } from "@/lib/meta-ads/client";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const cfg = await getMetaAdsConfig();
  // Live connectivity check — null means the ads token/ids aren't usable yet.
  const campaignCount = await fetchCampaigns()
    .then((c) => c.length)
    .catch(() => null);

  return NextResponse.json({
    hasToken: !!cfg.token,
    adAccountId: cfg.adAccountId || null,
    pageId: cfg.pageId || null,
    campaignCount,
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);

  const token: string | undefined = body?.token?.trim() || undefined;
  const adAccountId: string | undefined = body?.adAccountId?.trim() || undefined;
  const pageId: string | undefined = body?.pageId?.trim() || undefined;

  if (!token && !adAccountId && !pageId) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  await setMetaAdsConfig({ token, adAccountId, pageId });
  return NextResponse.json({ ok: true });
}
