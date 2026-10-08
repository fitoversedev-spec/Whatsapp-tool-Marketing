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
import { extractCity, extractSport, extractArea } from "./fieldMap";
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

type LeadHints = {
  pageId?: string | null;
  adId?: string | null;
  formId?: string | null;
  formName?: string | null;
  rawPayload?: unknown;
};

// The MetaLead columns derived from a fetched raw lead (everything except
// leadgenId / formName). Shared by the one-lead upsert (webhook, admin backfill)
// and the bulk sync. `campaignSport` is a per-run cache of campaign.sport so a
// bulk run looks each campaign up once instead of once per lead.
async function buildLeadData(
  lead: MetaLeadRaw,
  hints: LeadHints,
  campaignSport?: Map<string, string | null>
) {
  const fieldData = lead.field_data ?? [];

  const first = pickField(fieldData, ["first_name"]);
  const last = pickField(fieldData, ["last_name"]);
  const fullName =
    pickField(fieldData, ["full_name", "full name", "fullname", "name"]) ??
    ([first, last].filter(Boolean).join(" ").trim() || null);
  const phone = pickField(fieldData, ["phone_number", "phone"]);
  const email = pickField(fieldData, ["email"]);
  const city = extractCity(fieldData);
  let sport = extractSport(fieldData);
  const area = extractArea(fieldData);
  if (!sport && lead.campaign_id) {
    let campaignDefault = campaignSport?.get(lead.campaign_id);
    if (campaignDefault === undefined) {
      const campaign = await prisma.metaCampaign.findUnique({
        where: { metaId: lead.campaign_id },
        select: { sport: true },
      });
      campaignDefault = campaign?.sport ?? null;
      campaignSport?.set(lead.campaign_id, campaignDefault);
    }
    if (campaignDefault) sport = campaignDefault;
  }
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  const createdAtMeta = lead.created_time ? new Date(lead.created_time) : null;

  return {
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
    area,
    normalizedPhone,
    fieldData: JSON.stringify(fieldData),
    rawPayload: JSON.stringify(hints.rawPayload ?? lead),
    createdAtMeta,
  };
}

// Upsert a MetaLead from a fetched raw lead. `hints` supplies context present on
// the webhook change but not on the Graph lead node (page_id), plus fallbacks
// and the raw payload to persist for auditing.
export async function upsertMetaLead(lead: MetaLeadRaw, hints: LeadHints = {}): Promise<void> {
  const data = await buildLeadData(lead, hints);

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
// This downloads every lead-gen form's submissions from the Graph API but only
// WRITES the ones we don't have yet (bulk insert, idempotent on leadgenId), each
// stamped with its campaign so per-campaign captured counts catch up. Leads we
// already hold are left alone, except: ones still missing a campaign / form name
// that Meta now supplies are repaired, and a renamed campaign's new name is
// copied onto its leads. `created` is the number of rows genuinely inserted.
// A ~45 s time budget keeps the request under the serverless limit; running out
// returns partial: true and the next run carries on (everything done is kept).
// `formIds` limits the sweep; omitted = every form on the page.
const SYNC_BUDGET_MS = 45_000;
const INSERT_BATCH = 200;
const LOOKUP_CHUNK = 1000;

export async function syncMetaLeads(
  opts: { formIds?: string[]; limit?: number; budgetMs?: number } = {}
): Promise<{
  forms: number;
  fetched: number;
  created: number;
  partial: boolean;
  errors: { formId: string; error: string }[];
}> {
  const deadline = Date.now() + (opts.budgetMs && opts.budgetMs > 0 ? opts.budgetMs : SYNC_BUDGET_MS);
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
    return { forms: 0, fetched: 0, created: 0, partial: false, errors: [] };
  }

  const cfg = await getMetaAdsConfig();

  let fetched = 0;
  let created = 0;
  let partial = false;
  const errors: { formId: string; error: string }[] = [];
  const campaignSport = new Map<string, string | null>();
  const campaignNames = new Map<string, { name: string; at: number }>(); // raw campaign id -> name on its newest lead
  const repairs: { lead: MetaLeadRaw; formId: string }[] = [];

  // Phase 1: per form, download the leads and insert the ones we don't have.
  for (const formId of formIds) {
    if (Date.now() > deadline) {
      partial = true;
      break;
    }
    try {
      const leads = await fetchFormLeads(formId, limit);
      fetched += leads.length;
      const formName = formNames.get(formId) ?? null;

      const known = new Map<string, { campaignId: string | null; formName: string | null }>();
      for (let i = 0; i < leads.length; i += LOOKUP_CHUNK) {
        const rows = await prisma.metaLead.findMany({
          where: { leadgenId: { in: leads.slice(i, i + LOOKUP_CHUNK).map((l) => l.id) } },
          select: { leadgenId: true, campaignId: true, formName: true },
        });
        for (const r of rows) known.set(r.leadgenId, r);
      }

      const missing: MetaLeadRaw[] = [];
      for (const lead of leads) {
        if (lead.campaign_id && lead.campaign_name) {
          const at = (lead.created_time && Date.parse(lead.created_time)) || 0;
          const cur = campaignNames.get(lead.campaign_id);
          if (!cur || at >= cur.at) campaignNames.set(lead.campaign_id, { name: lead.campaign_name, at });
        }
        const have = known.get(lead.id);
        if (!have) missing.push(lead);
        else if ((!have.campaignId && lead.campaign_id) || (!have.formName && formName)) {
          repairs.push({ lead, formId });
        }
      }

      for (let i = 0; i < missing.length; i += INSERT_BATCH) {
        if (Date.now() > deadline) {
          partial = true;
          break;
        }
        const data = [];
        for (const lead of missing.slice(i, i + INSERT_BATCH)) {
          data.push({
            leadgenId: lead.id,
            ...(await buildLeadData(lead, { pageId: cfg.pageId || null, formId, formName }, campaignSport)),
            formName,
          });
        }
        const res = await prisma.metaLead.createMany({ data, skipDuplicates: true });
        created += res.count;
      }
      if (partial) break;
    } catch (err) {
      errors.push({ formId, error: err instanceof Error ? err.message : "fetch_failed" });
    }
  }

  // Phase 2: copy a renamed campaign's current name onto the leads that still
  // carry the old one (one update per campaign, only rows that differ).
  for (const [campaignId, { name }] of campaignNames) {
    if (Date.now() > deadline) {
      partial = true;
      break;
    }
    try {
      await prisma.metaLead.updateMany({
        where: { campaignId, OR: [{ campaignName: null }, { campaignName: { not: name } }] },
        data: { campaignName: name },
      });
    } catch (err) {
      console.error("[meta-ads] syncMetaLeads campaign rename failed", campaignId, err);
    }
  }

  // Phase 3: fill in the campaign / form name on leads we stored without them.
  for (const { lead, formId } of repairs) {
    if (Date.now() > deadline) {
      partial = true;
      break;
    }
    try {
      await upsertMetaLead(lead, {
        pageId: cfg.pageId || null,
        formId,
        formName: formNames.get(formId) ?? null,
      });
    } catch (err) {
      console.error("[meta-ads] syncMetaLeads repair failed", lead.id, err);
    }
  }

  return { forms: formIds.length, fetched, created, partial, errors };
}

export async function backfillLeadAreas(opts: { budgetMs?: number } = {}): Promise<{ updated: number }> {
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Infinity;
  const leads = await prisma.metaLead.findMany({
    where: { area: null },
    select: { id: true, fieldData: true },
  });
  let updated = 0;
  for (const lead of leads) {
    if (Date.now() > deadline) break; // the next run carries on
    let fieldData: MetaLeadFieldDatum[];
    try {
      fieldData = JSON.parse(lead.fieldData);
    } catch {
      continue;
    }
    if (!Array.isArray(fieldData)) continue;
    const area = extractArea(fieldData);
    if (area) {
      await prisma.metaLead.update({ where: { id: lead.id }, data: { area } });
      updated++;
    }
  }
  return { updated };
}
