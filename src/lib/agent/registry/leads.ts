import type { ToolDefinition } from "../permissions";
import type { AgentRouteSpec } from "../openapi";
import type { z } from "zod/v4";
import { AgentHttpError } from "../errors";
import type { ApprovalExecutor } from "../executors";
import type { AgentHandlerResult } from "../withAgent";
import * as S from "../schemas/leads";

// Stage 2: the tools that change leads. An admin can make any of them stricter
// (APPROVAL / NEVER) but never looser. The four APPROVAL ones below only queue a
// request for a human by default; the AI never deletes, merges, bulk-updates or
// takes ownership of an owned lead on its own.
const allowed = (action: ToolDefinition["action"], extra?: Partial<ToolDefinition>): ToolDefinition => ({
  default: "ALLOWED",
  action,
  ...extra,
});
const needsApproval = (action: ToolDefinition["action"]): ToolDefinition => ({
  default: "APPROVAL",
  action,
  neverLoosen: true,
});

export const TOOLS: Record<string, ToolDefinition> = {
  create_lead: allowed("create"),
  update_lead_details: allowed("update"),
  update_lead_phone: needsApproval("update"),
  set_requirements: allowed("update"),
  set_lead_stage: allowed("update"),
  remove_from_leads: needsApproval("update"),
  add_note: allowed("create"),
  save_conversation_summary: allowed("create"),
  add_product_interest: allowed("create"),
  assign_unassigned_lead: allowed("update"),
  reassign_lead: needsApproval("update"),
  escalate_lead: allowed("create", { group: "escalate" }),
  create_followup_task: allowed("create"),
  complete_task: allowed("update"),
  log_activity: allowed("create"),
  set_ad_lead_stage: allowed("update"),
  add_ad_lead_note: allowed("create"),
  move_ad_lead_to_crm: allowed("create"),
  request_merge: needsApproval("create"),
  request_mark_won: needsApproval("create"),
};

// Every route takes a JSON body. {id} in the path is the lead (or, for /tasks,
// the task; for /ads/leads, the ad lead). A 409 means "not allowed in the lead's
// current state"; its body carries a `reason` (and, for duplicates, `matches`).
export const ROUTES: AgentRouteSpec[] = [
  {
    path: "/leads",
    method: "post",
    tool: "create_lead",
    summary:
      "Create an UNASSIGNED lead (source: AI Sales Agent). Returns 409 reason=possible_duplicate with the matches unless confirmNotDuplicate:true and a duplicateReason are sent. The same phone created again within 10 minutes returns the existing lead (deduplicated:true).",
    requestSchema: S.createLeadBodySchema,
    responseSchema: S.createLeadResponseSchema,
  },
  {
    path: "/leads/{id}",
    method: "patch",
    tool: "update_lead_details",
    summary:
      "Update a lead's name, designation, email, city, business type, segment, notes (what the lead wants) and custom fields. Custom fields are merged, not replaced. The phone number cannot be changed here (use update_lead_phone).",
    requestSchema: S.updateLeadDetailsBodySchema,
    responseSchema: S.leadChangeResponseSchema,
  },
  {
    path: "/leads/{id}/phone",
    method: "patch",
    tool: "update_lead_phone",
    summary: "Request a change of a lead's phone number. Waits for human approval (202).",
    requestSchema: S.updateLeadPhoneBodySchema,
    responseSchema: S.leadChangeResponseSchema,
  },
  {
    path: "/leads/{id}/requirements",
    method: "put",
    tool: "set_requirements",
    summary:
      "Record what the lead needs (sport, budget in INR, location, court size in feet, surfaces, timeline, B2B/B2C, civil work). Merged into the lead under agent.* keys; send null to clear one.",
    requestSchema: S.setRequirementsBodySchema,
    responseSchema: S.leadChangeResponseSchema,
  },
  {
    path: "/leads/{id}/stage",
    method: "post",
    tool: "set_lead_stage",
    summary: "Move a lead to any active lead stage (stageId from get_crm_meta).",
    requestSchema: S.setLeadStageBodySchema,
    responseSchema: S.leadChangeResponseSchema,
  },
  {
    path: "/leads/{id}/remove",
    method: "post",
    tool: "remove_from_leads",
    summary: "Request that a lead leaves the Leads list (it is not deleted). Waits for human approval (202).",
    requestSchema: S.removeFromLeadsBodySchema,
    responseSchema: S.leadChangeResponseSchema,
  },
  {
    path: "/leads/{id}/notes",
    method: "post",
    tool: "add_note",
    summary: "Add a note to a lead (up to 5000 characters), authored by the AI.",
    requestSchema: S.addNoteBodySchema,
    responseSchema: S.noteResponseSchema,
  },
  {
    path: "/leads/{id}/summaries",
    method: "post",
    tool: "save_conversation_summary",
    summary: 'Save a conversation summary as a note titled "AI conversation summary — <date>" and log it on the lead timeline.',
    requestSchema: S.saveSummaryBodySchema,
    responseSchema: S.noteResponseSchema,
  },
  {
    path: "/leads/{id}/product-interests",
    method: "post",
    tool: "add_product_interest",
    summary: "Record which catalogue products (by id) or free-text product the lead is interested in. Already-recorded ones are skipped.",
    requestSchema: S.addProductInterestBodySchema,
    responseSchema: S.productInterestResponseSchema,
  },
  {
    path: "/leads/{id}/assign",
    method: "post",
    tool: "assign_unassigned_lead",
    summary:
      "Give an UNOWNED lead to a salesperson or manager. Returns 409 reason=already_owned if it has an owner (use reassign_lead to ask for a move).",
    requestSchema: S.assignLeadBodySchema,
    responseSchema: S.assignResponseSchema,
  },
  {
    path: "/leads/{id}/reassign",
    method: "post",
    tool: "reassign_lead",
    summary: "Request that a lead move to a different salesperson or manager. Waits for human approval (202).",
    requestSchema: S.reassignLeadBodySchema,
    responseSchema: S.assignResponseSchema,
  },
  {
    path: "/leads/{id}/escalations",
    method: "post",
    tool: "escalate_lead",
    summary:
      "Hand a lead to a human (sales, civil_engineer or manager) with a reason and summary: creates a high-priority follow-up for them, sends a push, and logs it on the timeline.",
    requestSchema: S.escalateLeadBodySchema,
    responseSchema: S.escalationResponseSchema,
  },
  {
    path: "/leads/{id}/tasks",
    method: "post",
    tool: "create_followup_task",
    summary: "Create a follow-up task on a lead, due in the future (within 180 days). The reminder goes to the lead's rep, never the AI.",
    requestSchema: S.createFollowupBodySchema,
    responseSchema: S.taskResponseSchema,
  },
  {
    path: "/tasks/{id}",
    method: "patch",
    tool: "complete_task",
    summary: "Complete (or reopen) a follow-up task. Only tasks the AI created itself; others return 403.",
    requestSchema: S.completeTaskBodySchema,
    responseSchema: S.taskResponseSchema,
  },
  {
    path: "/leads/{id}/activities",
    method: "post",
    tool: "log_activity",
    summary: "Log a call, meeting or WhatsApp conversation on a lead (activityTypeId from get_crm_meta).",
    requestSchema: S.logActivityBodySchema,
    responseSchema: S.activityResponseSchema,
  },
  {
    path: "/ads/leads/{id}/stage",
    method: "post",
    tool: "set_ad_lead_stage",
    summary: "Set the stage of a captured Meta ad lead (an active stage slug from get_crm_meta).",
    requestSchema: S.setAdLeadStageBodySchema,
    responseSchema: S.adLeadStageResponseSchema,
  },
  {
    path: "/ads/leads/{id}/notes",
    method: "post",
    tool: "add_ad_lead_note",
    summary: "Add a note to a captured Meta ad lead.",
    requestSchema: S.addAdLeadNoteBodySchema,
    responseSchema: S.adLeadNoteResponseSchema,
  },
  {
    path: "/ads/leads/{id}/move-to-crm",
    method: "post",
    tool: "move_ad_lead_to_crm",
    summary:
      "Promote a Meta ad lead into the CRM as an UNASSIGNED lead, reusing an existing contact with the same phone. Safe to repeat: an already-moved lead returns its link.",
    requestSchema: S.moveAdLeadBodySchema,
    responseSchema: S.moveAdLeadResponseSchema,
  },
  {
    path: "/leads/merge-requests",
    method: "post",
    tool: "request_merge",
    summary: "Ask a human to merge duplicate leads into one. Records the request only (202); the AI never merges.",
    requestSchema: S.requestMergeBodySchema,
    responseSchema: S.requestRecordedResponseSchema,
  },
  {
    path: "/leads/{id}/won-requests",
    method: "post",
    tool: "request_mark_won",
    summary: "Ask a human to mark a lead Won with a final value (INR), expected start date and note. Waits for approval (202).",
    requestSchema: S.requestMarkWonBodySchema,
    responseSchema: S.dealResponseSchema,
  },
];

// What runs when a person approves one of the five lead requests above. The stored
// input is re-validated first; the service is loaded on demand so that importing
// this registry (permissions, OpenAPI) stays light.
type LeadRunner = (args: { ctx: Parameters<ApprovalExecutor>[0]["ctx"]; input: unknown }) => Promise<AgentHandlerResult>;

function leadExecutor(
  tool: "update_lead_phone" | "remove_from_leads" | "reassign_lead" | "request_merge" | "request_mark_won",
  schema: z.ZodType,
): ApprovalExecutor {
  return async ({ ctx, input }) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw new AgentHttpError("invalid_input", "The saved request is no longer valid, so it was not run.");
    }
    const { LEAD_APPROVAL_EXECUTORS } = await import("../leads/service");
    const run = LEAD_APPROVAL_EXECUTORS[tool] as unknown as LeadRunner;
    const result = await run({ ctx, input: parsed.data });
    return { status: result.status ?? 200, body: result.body, recordIds: result.recordIds };
  };
}

export const EXECUTORS: Record<string, ApprovalExecutor> = {
  update_lead_phone: leadExecutor("update_lead_phone", S.updateLeadPhoneInputSchema),
  remove_from_leads: leadExecutor("remove_from_leads", S.removeFromLeadsInputSchema),
  reassign_lead: leadExecutor("reassign_lead", S.reassignLeadInputSchema),
  request_merge: leadExecutor("request_merge", S.requestMergeInputSchema),
  request_mark_won: leadExecutor("request_mark_won", S.requestMarkWonInputSchema),
};
