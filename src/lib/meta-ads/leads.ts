// Lead-gen Instant-Form ingestion. The Page's `leadgen` webhook change carries
// only ids (leadgen_id/form_id/page_id/ad_id/created_time) — we fetch the full
// lead (fetchLead) to get field_data, then upsert one MetaLead per submission.
//
// Handlers here NEVER throw (try/catch + console.error) so a bad lead can't
// break the shared /api/webhooks/whatsapp contract with Meta. Uses the ADS
// credential path only (fetchLead), never the WhatsApp/WABA token.

import { prisma } from "@/lib/prisma";
import { fetchLead, fetchFormName, fetchFormLeads, fetchLeadForms } from "./client";
import type { MetaLeadFieldDatum, MetaLeadRaw } from "./client";
import { getMetaAdsConfig } from "./config";
import { extractCity, extractSport } from "./fieldMap";
import { normalizePhone } from "@/lib/phone";

// The shape of a `leadgen` webhook change value (ids only — no field answers).
type LeadgenValue = {
  leadgen_id?: string;
  form_id?: string;
  page_id?: string;
  ad_id?: string;
  created_time?: number | string;
};

// First value for whichever of `names` appears in Meta's field_data (names are
// matched case-insensitively; Meta uses e.g. full_name / email / phone_number).
function pickField(fieldData: MetaLeadFieldDatum[], names: string[]): string | null {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const f of fieldData) {
    if (wanted.has((f.name ?? "").toLowerCase())) {
      const v = f.values?.[0];
      if (v) return v;
    }
  }
  return null;
}

// Upsert a MetaLead from a fetched raw lead. `hints` supplies context present on
// the webhook change but not on the Graph lead node (page_id), plus fallbacks
// and the raw payload to persist for auditing.
export async function upsertMetaLead(
  lead: MetaLeadRaw,
  hints: {
    pageId?: string | null;
    adId?: string | null;
    formId?: string | null;
    formName?: string | null;
    rawPayload?: unknown;
  } = {}
): Promise<void> {
  const fieldData = lead.field_data ?? [];

  const first = pickField(fieldData, ["first_name"]);
  const last = pickField(fieldData, ["last_name"]);
  const fullName =
    pickField(fieldData, ["full_name", "full name", "fullname", "name"]) ??
    ([first, last].filter(Boolean).join(" ").trim() || null);
  const phone = pickField(fieldData, ["phone_number", "phone"]);
  const email = pickField(fieldData, ["email"]);
  const city = extractCity(fieldData);
  const sport = extractSport(fieldData);
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  const createdAtMeta = lead.created_time ? new Date(lead.created_time) : null;

  const data = {
    formId: lead.form_id ?? hints.formId ?? null,
    pageId: hints.pageId ?? null,
    adId: lead.ad_id ?? hints.adId ?? null,
    campaignId: lead.campaign_id ?? null,
    campaignName: lead.campaign_name ?? null,
    fullName,
    phone,
    email,
    city,
    sport,
    normalizedPhone,
    fieldData: JSON.stringify(fieldData),
    rawPayload: JSON.stringify(hints.rawPayload ?? lead),
    createdAtMeta,
  };

  // formName is monotonic: set it on create, but on UPDATE only overwrite when
  // we actually resolved a name — never blank a previously-stored one. A
  // name-less re-processing (explicit-formIds backfill, or a webhook retry where
  // fetchFormName transiently returned null) must not wipe a good form name.
  const formNamePatch = hints.formName ? { formName: hints.formName } : {};

  await prisma.metaLead.upsert({
    where: { leadgenId: lead.id },
    update: { ...data, ...formNamePatch },
    create: { leadgenId: lead.id, ...data, formName: hints.formName ?? null },
  });
}

// Webhook entry point for a single `leadgen` change value.
export async function handleLeadgen(value: LeadgenValue): Promise<void> {
  try {
    const leadgenId = value?.leadgen_id;
    if (!leadgenId) return;

    const lead = await fetchLead(leadgenId);
    const formId = lead.form_id ?? value.form_id ?? null;
    const formName = formId ? await fetchFormName(formId) : null;
    await upsertMetaLead(lead, {
      pageId: value.page_id ?? null,
      adId: value.ad_id ?? null,
      formId,
      formName,
      rawPayload: { value, lead },
    });
  } catch (err) {
    console.error("[meta-ads] handleLeadgen failed", err);
  }
}

// On-demand lead reconciliation. Meta never REPLAYS leadgen webhooks, so if the
// real-time webhook missed submissions (or was subscribed after leads had
// already come in), our captured count drifts BELOW Meta's own insight count.
// This pulls every lead-gen form's submissions straight from the Graph API and
// upserts the missing ones (idempotent on leadgenId), stamping each with its
// campaign so per-campaign captured counts catch up. Returns how many were
// genuinely NEW. `formIds` limits the sweep; omitted = every form on the page.
export async function syncMetaLeads(
  opts: { formIds?: string[]; limit?: number } = {}
): Promise<{
  forms: number;
  fetched: number;
  created: number;
  errors: { formId: string; error: string }[];
}> {
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 500) : 200;

  // formId -> friendly name so freshly-synced leads get their form name too.
  const formNames = new Map<string, string>();
  let formIds = (opts.formIds ?? []).map((f) => String(f)).filter(Boolean);
  if (formIds.length === 0) {
    const forms = await fetchLeadForms();
    formIds = forms.map((f) => f.id);
    forms.forEach((f) => formNames.set(f.id, f.name));
  }
  if (formIds.length === 0) {
    return { forms: 0, fetched: 0, created: 0, errors: [] };
  }

  const cfg = await getMetaAdsConfig();

  // Snapshot existing ids up front so we can report how many synced leads are
  // genuinely NEW — a bare upsert can't tell a create from an update.
  const existing = new Set(
    (await prisma.metaLead.findMany({ select: { leadgenId: true } })).map((r) => r.leadgenId)
  );

  let fetched = 0;
  let created = 0;
  const errors: { formId: string; error: string }[] = [];

  for (const formId of formIds) {
    try {
      const leads = await fetchFormLeads(formId, limit);
      for (const lead of leads) {
        try {
          await upsertMetaLead(lead, {
            pageId: cfg.pageId || null,
            formId,
            formName: formNames.get(formId) ?? null,
          });
          fetched += 1;
          if (!existing.has(lead.id)) {
            created += 1;
            existing.add(lead.id);
          }
        } catch (err) {
          console.error("[meta-ads] syncMetaLeads upsert failed", lead.id, err);
        }
      }
    } catch (err) {
      errors.push({ formId, error: err instanceof Error ? err.message : "fetch_failed" });
    }
  }

  return { forms: formIds.length, fetched, created, errors };
}
