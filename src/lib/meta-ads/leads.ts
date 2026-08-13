// Lead-gen Instant-Form ingestion. The Page's `leadgen` webhook change carries
// only ids (leadgen_id/form_id/page_id/ad_id/created_time) — we fetch the full
// lead (fetchLead) to get field_data, then upsert one MetaLead per submission.
//
// Handlers here NEVER throw (try/catch + console.error) so a bad lead can't
// break the shared /api/webhooks/whatsapp contract with Meta. Uses the ADS
// credential path only (fetchLead), never the WhatsApp/WABA token.

import { prisma } from "@/lib/prisma";
import { fetchLead, fetchFormName } from "./client";
import type { MetaLeadFieldDatum, MetaLeadRaw } from "./client";
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
