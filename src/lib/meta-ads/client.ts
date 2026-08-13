// Meta Marketing API (ads) Graph client. Mirrors the axios call shape, 30s
// timeout, and error normalization of src/lib/whatsapp.ts — but uses the ADS
// token/ids (getMetaAdsConfig), NOT getMetaAccessToken() (that is the WABA
// token). Keep this file free of any WhatsApp/WABA credential access.

import axios, { AxiosError, AxiosResponse } from "axios";
import { getMetaAdsConfig } from "./config";

const API_VERSION = process.env.META_GRAPH_API_VERSION || "v21.0";

// axios has no default timeout — bound every ads call so a hung Graph endpoint
// can't stall the cron sweep or the webhook handler indefinitely.
const META_TIMEOUT_MS = 30_000;

const graphUrl = (node: string) => `https://graph.facebook.com/${API_VERSION}/${node}`;

// Local error normalizer — deliberately NOT imported from whatsapp.ts
// (describeMetaError) or meta-connection.ts (safeGet), both of which are tied
// to the WABA credential path. Same { code, message } shape.
export function metaAdsErr(err: unknown): { code: string; message: string } {
  if (err instanceof AxiosError && err.response?.data?.error) {
    const e = err.response.data.error;
    return { code: String(e.code ?? "unknown"), message: e.message ?? "Meta ads error" };
  }
  if (err instanceof Error) return { code: "client", message: err.message };
  return { code: "unknown", message: "Unknown error" };
}

// Load the ads token or throw a friendly, actionable error. Callers surface
// this message to admins on the Connection page.
async function requireAdsToken(): Promise<{ token: string; adAccountId: string; pageId: string }> {
  const cfg = await getMetaAdsConfig();
  if (!cfg.token) {
    throw new Error(
      "Meta ads token not configured. Add it on the Connection page (or set META_ADS_TOKEN)."
    );
  }
  return cfg;
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// Lead-gen endpoints (/<leadgen_id>, /<form_id>/leads, /<form_id>,
// /<page_id>/leadgen_forms) must be called with a PAGE access token, not the
// system-user token (Graph rejects the SU token with #190/#200). We derive a
// page token from the SU token — which requires the system user to have the
// Page assigned with full access — and cache it for the process. A caller
// clears the cache on an auth rejection so the next call re-derives.
let pageTokenCache: string | null = null;

async function getPageToken(): Promise<string> {
  if (pageTokenCache) return pageTokenCache;
  const { token, pageId } = await requireAdsToken();
  if (!pageId) {
    throw new Error("Meta ads page id not configured (needed for lead retrieval).");
  }
  try {
    const res = await axios.get(graphUrl(pageId), {
      headers: authHeaders(token),
      params: { fields: "access_token" },
      timeout: META_TIMEOUT_MS,
    });
    const pt = res.data?.access_token as string | undefined;
    if (!pt) throw new Error("Graph returned no page access_token.");
    pageTokenCache = pt;
    return pt;
  } catch (err) {
    const { code, message } = metaAdsErr(err);
    throw new Error(
      `Meta ads getPageToken failed (${code}): ${message}. Ensure the system user has the Page assigned with full access.`
    );
  }
}

export type MetaCampaignRow = {
  id: string;
  name: string;
  objective?: string;
  status?: string;
  created_time?: string;
};

export type MetaInsightAction = { action_type: string; value?: string };

export type MetaInsightRaw = {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: MetaInsightAction[];
  date_start?: string;
  date_stop?: string;
};

// Normalized, per-campaign/per-day insight row with leads/cpl/ctr derived.
export type MetaInsight = {
  campaignId: string;
  campaignName: string;
  date: string; // YYYY-MM-DD (from date_start)
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  cpl: number | null;
  ctr: number | null;
};

export type MetaLeadFieldDatum = { name: string; values: string[] };

export type MetaLeadRaw = {
  id: string;
  created_time?: string;
  field_data?: MetaLeadFieldDatum[];
  ad_id?: string;
  form_id?: string;
  campaign_id?: string;
  campaign_name?: string;
};

// action_type values that represent a lead, in priority order. Meta's insights
// actions[] frequently reports the SAME conversion under more than one of these
// simultaneously (e.g. a Lead-gen Instant-Form campaign emits both
// onsite_conversion.lead_grouped AND lead for the same submissions), so we pick
// the single best-matching type rather than summing — summing double-counts.
// Instant-Form (onsite) first, then the generic standard event, then "other".
const LEAD_ACTION_TYPES = [
  "onsite_conversion.lead_grouped",
  "lead",
  "leadgen.other",
] as const;

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

// Follow data.paging.next cursors, accumulating every page's data[]. Uses the
// absolute `next` URL Graph returns (already carries token + cursor), so we
// only re-attach the timeout.
async function paginate<T>(
  firstUrl: string,
  params: Record<string, string | number>,
  token: string
): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined = firstUrl;
  let firstParams: Record<string, string | number> | undefined = params;

  while (url) {
    const res: AxiosResponse = await axios.get(url, {
      headers: authHeaders(token),
      params: firstParams,
      timeout: META_TIMEOUT_MS,
    });
    const rows: T[] = res.data?.data ?? [];
    out.push(...rows);
    url = res.data?.paging?.next;
    firstParams = undefined; // `next` already encodes params + cursor
  }
  return out;
}

// GET /act_<id>/campaigns — every campaign in the ad account.
export async function fetchCampaigns(): Promise<MetaCampaignRow[]> {
  const { token, adAccountId } = await requireAdsToken();
  try {
    return await paginate<MetaCampaignRow>(
      graphUrl(`act_${adAccountId}/campaigns`),
      { fields: "id,name,objective,status,created_time", limit: 100 },
      token
    );
  } catch (err) {
    const { code, message } = metaAdsErr(err);
    throw new Error(`Meta ads fetchCampaigns failed (${code}): ${message}`);
  }
}

// GET /act_<id>/insights — per-campaign, per-day performance over [since,until].
// Dates are "YYYY-MM-DD". Derives leads from actions[]; computes cpl + ctr with
// divide-by-zero guards (-> null).
export async function fetchInsights(since: string, until: string): Promise<MetaInsight[]> {
  const { token, adAccountId } = await requireAdsToken();
  try {
    const raw = await paginate<MetaInsightRaw>(
      graphUrl(`act_${adAccountId}/insights`),
      {
        level: "campaign",
        time_increment: 1,
        fields: "campaign_id,campaign_name,spend,impressions,reach,clicks,actions",
        time_range: JSON.stringify({ since, until }),
        limit: 100,
      },
      token
    );

    return raw.map((r) => {
      const spend = toNum(r.spend); // Decimal column — keep full precision
      // Int columns: round so a fractional/attributed value from Meta can't be
      // rejected by the Prisma Int field (which would abort the whole sync).
      const impressions = Math.round(toNum(r.impressions));
      const clicks = Math.round(toNum(r.clicks));
      // Pick the single best-matching lead action (priority order) — never sum
      // across overlapping action_types, which would double-count.
      const leadAction = LEAD_ACTION_TYPES.map((t) =>
        (r.actions ?? []).find((a) => a.action_type === t)
      ).find(Boolean);
      const leads = Math.round(toNum(leadAction?.value));
      const cpl = leads > 0 ? spend / leads : null;
      // ctr as a FRACTION (0..1) to match the app-wide convention (fmtPct
      // multiplies by 100); storing a percent here would render 100x too high.
      const ctr = impressions > 0 ? clicks / impressions : null;
      return {
        campaignId: r.campaign_id ?? "",
        campaignName: r.campaign_name ?? "",
        date: r.date_start ?? "",
        spend,
        impressions,
        reach: Math.round(toNum(r.reach)),
        clicks,
        leads,
        cpl,
        ctr,
      };
    });
  } catch (err) {
    const { code, message } = metaAdsErr(err);
    throw new Error(`Meta ads fetchInsights failed (${code}): ${message}`);
  }
}

// GET /<leadgen_id> — a single lead's full form answers. Used by the webhook
// handler and backfill.
export async function fetchLead(leadgenId: string): Promise<MetaLeadRaw> {
  const pageToken = await getPageToken();
  try {
    const res = await axios.get(graphUrl(leadgenId), {
      headers: authHeaders(pageToken),
      params: { fields: "id,created_time,field_data,ad_id,form_id,campaign_id,campaign_name" },
      timeout: META_TIMEOUT_MS,
    });
    return res.data as MetaLeadRaw;
  } catch (err) {
    pageTokenCache = null; // page token may be stale/invalid — re-derive next call
    const { code, message } = metaAdsErr(err);
    throw new Error(`Meta ads fetchLead failed (${code}): ${message}`);
  }
}

// GET /<form_id>/leads — backfill leads for a form (Meta doesn't replay
// webhooks). Paginates; `limit` caps rows requested per page.
export async function fetchFormLeads(formId: string, limit = 100): Promise<MetaLeadRaw[]> {
  const pageToken = await getPageToken();
  try {
    return await paginate<MetaLeadRaw>(
      graphUrl(`${formId}/leads`),
      {
        fields: "id,created_time,field_data,ad_id,form_id,campaign_id,campaign_name",
        limit,
      },
      pageToken
    );
  } catch (err) {
    pageTokenCache = null;
    const { code, message } = metaAdsErr(err);
    throw new Error(`Meta ads fetchFormLeads failed (${code}): ${message}`);
  }
}

export type LeadForm = { id: string; name: string; status?: string; leadsCount?: number };

// GET /<page_id>/leadgen_forms — the page's lead-gen forms (id + friendly name).
// Used to discover forms for backfill and to resolve form names. Page token.
export async function fetchLeadForms(): Promise<LeadForm[]> {
  const { pageId } = await requireAdsToken();
  if (!pageId) throw new Error("Meta ads page id not configured.");
  const pageToken = await getPageToken();
  try {
    const rows = await paginate<{
      id: string;
      name?: string;
      status?: string;
      leads_count?: number;
    }>(
      graphUrl(`${pageId}/leadgen_forms`),
      { fields: "id,name,status,leads_count", limit: 100 },
      pageToken
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name ?? r.id,
      status: r.status,
      leadsCount: r.leads_count,
    }));
  } catch (err) {
    pageTokenCache = null;
    const { code, message } = metaAdsErr(err);
    throw new Error(`Meta ads fetchLeadForms failed (${code}): ${message}`);
  }
}

// GET /<form_id>?fields=name — a lead form's friendly name (the leadgen webhook
// carries only form_id). Cached per form. Returns null on ANY failure — formName
// is cosmetic and must never block lead ingestion.
const formNameCache = new Map<string, string | null>();
export async function fetchFormName(formId: string): Promise<string | null> {
  if (formNameCache.has(formId)) return formNameCache.get(formId) ?? null;
  try {
    const pageToken = await getPageToken();
    const res = await axios.get(graphUrl(formId), {
      headers: authHeaders(pageToken),
      params: { fields: "name" },
      timeout: META_TIMEOUT_MS,
    });
    const name = (res.data?.name as string | undefined) ?? null;
    formNameCache.set(formId, name);
    return name;
  } catch {
    formNameCache.set(formId, null);
    return null;
  }
}
