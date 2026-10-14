import type { ToolDefinition } from "../permissions";
import type { AgentRouteSpec } from "../openapi";
import * as S from "../schemas/read";

// Stage 1: read-only tools. Every one is ALLOWED by default and rate-limited in
// the "read" group. An admin can only tighten that (APPROVAL / NEVER), never loosen it.
const read = (): ToolDefinition => ({ default: "ALLOWED", action: "read" });

export const TOOLS: Record<string, ToolDefinition> = {
  get_crm_meta: read(),
  search_leads: read(),
  get_lead: read(),
  get_lead_timeline: read(),
  check_duplicates: read(),
  list_ad_leads: read(),
  get_ad_lead: read(),
  get_ad_lead_analytics: read(),
  search_catalogue: read(),
  get_product: read(),
  compare_products: read(),
  check_availability: read(),
  get_rate_sheet: read(),
  estimate_price: read(),
  list_deals: read(),
  get_deal: read(),
  get_pipeline: read(),
  get_analytics: read(),
};

// GET routes take their input as query-string parameters, listed in each summary
// (the spec format has no slot for query parameters; the request schemas are
// exported from ../schemas/read as *QuerySchema). POST routes carry a JSON body
// and declare it as the request schema. Every list takes `limit` (default 20,
// max 100) and a `cursor` (or `page`).
export const ROUTES: AgentRouteSpec[] = [
  {
    path: "/meta",
    method: "get",
    tool: "get_crm_meta",
    summary: "CRM vocabulary: lead stages, lead sources, activity types, customer profiles, supported sports, product types, ad-lead stages.",
    responseSchema: S.crmMetaResponseSchema,
  },
  {
    path: "/leads",
    method: "get",
    tool: "search_leads",
    summary:
      "Search CRM leads by name, company or phone. Query: q, phone (last digits ok), stageId, ownerId, source (name or id), includeContacts (true = also non-lead customers), limit (1-100, default 20), cursor.",
    responseSchema: S.searchLeadsResponseSchema,
  },
  {
    path: "/leads/{id}",
    method: "get",
    tool: "get_lead",
    summary: "One customer in full: company, stage, rep, custom fields, notes, next actions and tasks, product interests, deals and quotes summary. No private rep insights, attachments or internal cost.",
    responseSchema: S.leadDetailSchema,
  },
  {
    path: "/leads/{id}/timeline",
    method: "get",
    tool: "get_lead_timeline",
    summary: "What has happened with this customer, newest first, without anything private to a rep. Query: limit (1-100, default 20), cursor.",
    responseSchema: S.leadTimelineResponseSchema,
  },
  {
    path: "/leads/duplicate-check",
    method: "post",
    tool: "check_duplicates",
    summary: "Read-only duplicate check by name, phone and company across CRM leads and contacts, WhatsApp contacts and ad leads. Creates nothing.",
    requestSchema: S.duplicateCheckBodySchema,
    responseSchema: S.duplicateCheckResponseSchema,
  },
  {
    path: "/ads/leads",
    method: "get",
    tool: "list_ad_leads",
    summary:
      "Meta lead-form leads, newest first. Query: from, to (YYYY-MM-DD), campaign, city, sport, area, start, stage (slug), assigned, label, limit (1-100, default 20), page. No export.",
    responseSchema: S.adLeadsResponseSchema,
  },
  {
    path: "/ads/leads/{id}",
    method: "get",
    tool: "get_ad_lead",
    summary: "One Meta lead with its form answers, sales follow-up data, notes and reminders.",
    responseSchema: S.adLeadDetailSchema,
  },
  {
    path: "/ads/lead-analytics",
    method: "get",
    tool: "get_ad_lead_analytics",
    summary: "Meta lead counts by city, sport, area, job and campaign. Query: from, to (YYYY-MM-DD; both optional, default all time).",
    responseSchema: S.adLeadAnalyticsResponseSchema,
  },
  {
    path: "/catalogue/products",
    method: "get",
    tool: "search_catalogue",
    summary:
      "Search live catalogue products with specs, media and TDS titles. Query: q, sport, type (flooring|material|equipment), limit (1-100, default 20), cursor. priceInr is only ever returned as indicativePrice with priceStatus indicative_unconfirmed.",
    responseSchema: S.catalogueSearchResponseSchema,
  },
  {
    path: "/catalogue/products/{id}",
    method: "get",
    tool: "get_product",
    summary: "One live product. Any price is indicative and unconfirmed.",
    responseSchema: S.productSchema,
  },
  {
    path: "/catalogue/products/{id}/availability",
    method: "get",
    tool: "check_availability",
    summary: "Stock is not tracked here: always status unknown, confirmed by the Fitoverse team.",
    responseSchema: S.availabilityResponseSchema,
  },
  {
    path: "/catalogue/compare",
    method: "post",
    tool: "compare_products",
    summary: "Side-by-side spec comparison of 2 to 4 products, computed server-side. Read-only.",
    requestSchema: S.compareBodySchema,
    responseSchema: S.compareResponseSchema,
  },
  {
    path: "/pricing/rate-sheet",
    method: "get",
    tool: "get_rate_sheet",
    summary: "Standard rate sheet for one sport. Query: sport (football|basketball|multisport|pickleball|tennis|volleyball|cricket|badminton). source says whether it is the admin sheet or the built-in default.",
    responseSchema: S.rateSheetResponseSchema,
  },
  {
    path: "/pricing/estimate",
    method: "post",
    tool: "estimate_price",
    summary: "Indicative price estimate for a plot from the rate sheet. The caller never supplies a rate. Read-only: nothing is saved and it is not a quotation.",
    requestSchema: S.estimateBodySchema,
    responseSchema: S.estimateResponseSchema,
  },
  {
    path: "/deals",
    method: "get",
    tool: "list_deals",
    summary: "Confirmed (won) projects, newest first. Query: q, from, to (YYYY-MM-DD, by won date), limit (1-100, default 20), cursor.",
    responseSchema: S.dealsResponseSchema,
  },
  {
    path: "/deals/{id}",
    method: "get",
    tool: "get_deal",
    summary: "One confirmed project with stage history, line items and quotes.",
    responseSchema: S.dealDetailSchema,
  },
  {
    path: "/pipeline",
    method: "get",
    tool: "get_pipeline",
    summary: "Lead counts per stage plus lead rows. Query: stageId (a stage id, or 'unstaged'), limit (1-100, default 20), cursor.",
    responseSchema: S.pipelineResponseSchema,
  },
  {
    path: "/analytics/{report}",
    method: "get",
    tool: "get_analytics",
    summary:
      "Company-wide analytics, no per-rep figures. {report} is one of kpi_board, funnel, products, geography, sources, seasonality, open_deals. Query: period (this_week|last_week|this_month|last_month|this_quarter|this_fy|all_time) or from and to (YYYY-MM-DD); open_deals also takes limit and page.",
    responseSchema: S.analyticsResponseSchema,
  },
];
