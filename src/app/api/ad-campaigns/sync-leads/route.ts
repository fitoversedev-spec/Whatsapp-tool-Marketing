// POST /api/ad-campaigns/sync-leads — on-demand lead reconciliation, available
// to any signed-in user from the Ad Campaigns page. Meta doesn't replay leadgen
// webhooks, so when real-time capture misses submissions the tool's captured
// count falls behind Meta's insight count. This pulls every lead-gen form's
// submissions and upserts the missing ones (idempotent), closing the gap. It is
// the user-facing sibling of the admin-only /api/admin/meta-ads/backfill.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { metaAdsConfigured } from "@/lib/meta-ads/config";
import { syncMetaLeads } from "@/lib/meta-ads/leads";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!(await metaAdsConfigured())) {
    return NextResponse.json({ error: "Meta Ads is not connected yet." }, { status: 400 });
  }

  try {
    const result = await syncMetaLeads({ limit: 200 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lead sync failed." },
      { status: 502 }
    );
  }
}
