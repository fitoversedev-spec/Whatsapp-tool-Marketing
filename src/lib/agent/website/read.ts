import type { z } from "zod/v4";
import {
  getWebsiteLeadDetail,
  getWebsiteLeadPage,
  parseLeadRange,
  type WebsiteLeadDetail,
  type WebsiteLeadFilters,
  type WebsiteLeadRow as BackendRow,
} from "@/lib/website-leads/list";
import { AgentHttpError } from "../errors";
import type { WebsiteLeadRow, WebsiteLeadsInput, websiteLeadDetailSchema } from "../schemas/website";
import { requireId } from "../read/shared";

/**
 * Website leads (enquiries from the fitoverse.com court configurator) for the
 * agent. Reuses the Website Leads page's list and detail queries. Only fields a
 * salesperson would say out loud leave the server: no normalised phone,
 * user-agent, website-side ids or internal user ids, and no export.
 */

export function toAgentWebsiteLead(r: BackendRow): WebsiteLeadRow {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    city: r.city,
    state: r.state,
    sport: r.sport,
    size: { areaSqft: r.areaSqft, lengthFt: r.lengthFt, widthFt: r.widthFt },
    startTime: r.startWhen,
    stage: r.stage,
    labels: r.labels.map((l) => l.name),
    assignedTo: r.assignedToName,
    inCrm: r.inCrm,
    receivedAt: r.receivedAt,
    badges: r.badges.map((b) => ({ kind: b.kind, label: b.label, id: b.id })),
  };
}

export function websiteLeadFilters(input: Omit<WebsiteLeadsInput, "limit" | "page">): WebsiteLeadFilters {
  const { from, to } = parseLeadRange(input.from, input.to);
  return {
    from,
    to,
    city: input.city,
    sport: input.sport,
    areaMin: input.areaMin,
    areaMax: input.areaMax,
    stage: input.stage,
    assigned: input.assigned,
    label: input.label,
    q: input.q,
  };
}

export async function listWebsiteLeads(input: WebsiteLeadsInput) {
  const page = await getWebsiteLeadPage(websiteLeadFilters(input), input.page, input.limit);
  return {
    items: page.rows.map(toAgentWebsiteLead),
    total: page.total,
    page: page.page,
    pageCount: page.pageCount,
    limit: input.limit,
  };
}

export function toAgentWebsiteLeadDetail(d: WebsiteLeadDetail): z.infer<typeof websiteLeadDetailSchema> {
  return {
    ...toAgentWebsiteLead(d),
    jobTitle: d.jobTitle,
    customerMessage: d.notes,
    formAnswers: d.answers.map((a) => ({ name: a.label, value: a.value })),
    surface: d.surface,
    courtEnvironment: d.env,
    inMarketing: d.inMarketing,
    notes: d.internalNotes.map((n) => ({ id: n.id, body: n.body, author: n.authorName, createdAt: n.createdAt })),
  };
}

export async function getWebsiteLead(rawId: string | undefined) {
  const id = requireId(rawId, "Website lead");
  const detail = await getWebsiteLeadDetail(id);
  if (!detail) throw new AgentHttpError("not_found", "Website lead not found.");
  return toAgentWebsiteLeadDetail(detail);
}
