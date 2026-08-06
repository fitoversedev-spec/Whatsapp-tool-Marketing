// POST /api/admin/meta-ads/backfill — admin-only. Meta doesn't replay webhooks,
// so this pulls recent leads for the page's lead-gen forms via fetchFormLeads
// and upserts them into meta_leads (idempotent on leadgenId).
//
// Body (optional): { formIds?: string[], limit?: number }. When formIds is
// omitted we backfill every form id already seen via the leadgen webhook.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMetaAdsConfig, metaAdsConfigured } from "@/lib/meta-ads/config";
import { fetchFormLeads } from "@/lib/meta-ads/client";
import { upsertMetaLead } from "@/lib/meta-ads/leads";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!(await metaAdsConfigured())) {
    return NextResponse.json({ error: "meta ads not configured" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const limit = Number(body?.limit) > 0 ? Math.min(Number(body.limit), 500) : 100;

  // Which forms to backfill: explicit ids from the body, else the distinct form
  // ids we've already recorded from prior leadgen webhooks.
  let formIds: string[] = Array.isArray(body?.formIds)
    ? body.formIds.map((f: unknown) => String(f)).filter(Boolean)
    : [];
  if (formIds.length === 0) {
    const seen = await prisma.metaLead.findMany({
      where: { formId: { not: null } },
      distinct: ["formId"],
      select: { formId: true },
    });
    formIds = seen.map((r) => r.formId).filter((f): f is string => !!f);
  }

  if (formIds.length === 0) {
    return NextResponse.json({
      ok: true,
      forms: 0,
      upserted: 0,
      note: "No form ids supplied and none seen yet — pass { formIds: [...] } to backfill.",
    });
  }

  const cfg = await getMetaAdsConfig();
  let upserted = 0;
  const errors: { formId: string; error: string }[] = [];

  for (const formId of formIds) {
    try {
      const leads = await fetchFormLeads(formId, limit);
      for (const lead of leads) {
        try {
          await upsertMetaLead(lead, { pageId: cfg.pageId || null, formId });
          upserted += 1;
        } catch (err) {
          console.error("[meta-ads] backfill upsert failed", lead.id, err);
        }
      }
    } catch (err) {
      errors.push({ formId, error: err instanceof Error ? err.message : "fetch_failed" });
    }
  }

  return NextResponse.json({ ok: true, forms: formIds.length, upserted, errors });
}
