// POST /api/admin/meta-ads/backfill — admin-only. Meta doesn't replay webhooks,
// so this pulls recent leads for the page's lead-gen forms via fetchFormLeads
// and upserts them into meta_leads (idempotent on leadgenId).
//
// Body (optional): { formIds?: string[], limit?: number }. When formIds is
// omitted we backfill every form id already seen via the leadgen webhook.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMetaAdsConfig, metaAdsConfigured } from "@/lib/meta-ads/config";
import { fetchFormLeads, fetchLeadForms } from "@/lib/meta-ads/client";
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

  // formId -> friendly name, so backfilled leads get formName too.
  const formNames = new Map<string, string>();

  // Which forms to backfill: explicit ids from the body, else discover every
  // lead-gen form on the page directly from Meta (works on the first backfill,
  // before any webhook has been seen).
  let formIds: string[] = Array.isArray(body?.formIds)
    ? body.formIds.map((f: unknown) => String(f)).filter(Boolean)
    : [];
  if (formIds.length === 0) {
    try {
      const forms = await fetchLeadForms();
      formIds = forms.map((f) => f.id);
      forms.forEach((f) => formNames.set(f.id, f.name));
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "form_discovery_failed" },
        { status: 502 }
      );
    }
  }

  if (formIds.length === 0) {
    return NextResponse.json({
      ok: true,
      forms: 0,
      upserted: 0,
      note: "No lead-gen forms found on the page.",
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
          await upsertMetaLead(lead, { pageId: cfg.pageId || null, formId, formName: formNames.get(formId) ?? null });
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
