import type { ToolDefinition } from "../permissions";
import type { AgentRouteSpec } from "../openapi";
import * as S from "../schemas/website";

// Website leads: enquiries from the fitoverse.com court configurator. They mirror the
// ad-lead tools exactly. An admin can make any verdict stricter, never looser.
// assign_website_lead is NEVER and has no route: it exists so the permission table
// says plainly that handing a lead to a rep is a human's decision, as with ad leads.
const allowed = (action: ToolDefinition["action"]): ToolDefinition => ({ default: "ALLOWED", action });
const never = (action: ToolDefinition["action"]): ToolDefinition => ({ default: "NEVER", action, neverLoosen: true });

export const TOOLS: Record<string, ToolDefinition> = {
  list_website_leads: allowed("read"),
  get_website_lead: allowed("read"),
  set_website_lead_stage: allowed("update"),
  add_website_lead_note: allowed("create"),
  move_website_lead_to_crm: allowed("create"),
  assign_website_lead: never("update"),
};

// {id} in the path is the website lead (WebsiteLead.id, not the website's own id).
export const ROUTES: AgentRouteSpec[] = [
  {
    path: "/website-leads",
    method: "get",
    tool: "list_website_leads",
    summary:
      "Website (fitoverse.com) enquiries, newest first, with name, phone, city, sport, court size, start time, stage, rep, received time and duplicate badges. Query: from, to (YYYY-MM-DD, by received date), city, sport, areaMin, areaMax (sq ft), stage (slug), assigned ('unassigned', a user id or part of a rep's name), label, q (name, phone or email), limit (1-100, default 20), page. No export.",
    querySchema: S.websiteLeadsQuerySchema,
    responseSchema: S.websiteLeadsResponseSchema,
  },
  {
    path: "/website-leads/{id}",
    method: "get",
    tool: "get_website_lead",
    summary: "One website lead in full: contact details, court size, the customer's message and form answers, badges, notes and stage.",
    responseSchema: S.websiteLeadDetailSchema,
  },
  {
    path: "/website-leads/{id}/stage",
    method: "post",
    tool: "set_website_lead_stage",
    summary: "Set the stage of a website lead (an active stage slug; the same list as ad leads, see adLeadStages in get_crm_meta).",
    requestSchema: S.setWebsiteLeadStageBodySchema,
    responseSchema: S.websiteLeadStageResponseSchema,
  },
  {
    path: "/website-leads/{id}/notes",
    method: "post",
    tool: "add_website_lead_note",
    summary: "Add a note (up to 5000 characters) to a website lead, authored by the AI.",
    requestSchema: S.addWebsiteLeadNoteBodySchema,
    responseSchema: S.websiteLeadNoteResponseSchema,
  },
  {
    path: "/website-leads/{id}/move-to-crm",
    method: "post",
    tool: "move_website_lead_to_crm",
    summary:
      "Promote a website lead into the CRM as an UNASSIGNED lead, reusing an existing contact with the same phone. Safe to repeat: an already-moved lead returns its link.",
    requestSchema: S.moveWebsiteLeadBodySchema,
    responseSchema: S.moveWebsiteLeadResponseSchema,
  },
];
