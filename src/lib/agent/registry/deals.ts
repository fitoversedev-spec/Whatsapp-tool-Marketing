import type { ToolDefinition } from "../permissions";
import type { AgentRouteSpec } from "../openapi";
import type { ApprovalExecutor } from "../executors";
import * as S from "../schemas/deals";

// Stage 6 (deals and campaigns). An admin can make any verdict stricter, never
// looser. The two NEVER rows have no route: they exist so the permission table
// says plainly what the AI cannot do.
const allowed = (action: ToolDefinition["action"]): ToolDefinition => ({ default: "ALLOWED", action });
const needsApproval = (action: ToolDefinition["action"]): ToolDefinition => ({
  default: "APPROVAL",
  action,
  neverLoosen: true,
});
const never = (action: ToolDefinition["action"]): ToolDefinition => ({ default: "NEVER", action, neverLoosen: true });

export const TOOLS: Record<string, ToolDefinition> = {
  // Deals: only these two edits, and only after a person says yes.
  set_deal_execution_status: needsApproval("update"),
  update_deal_won_value: needsApproval("update"),
  delete_deal: never("delete"),
  change_deal_owner: never("update"),
  // Campaigns: no bulk messaging outside approved campaign limits (agent_campaign_limits).
  draft_broadcast: allowed("create"),
  get_broadcast_status: allowed("read"),
  pause_broadcast: allowed("update"),
  launch_broadcast: needsApproval("send"),
  schedule_broadcast: needsApproval("send"),
};

const REFUSALS =
  " Refusals come back as { error: { code, message } } and are stored against the Idempotency-Key: use a new key for each new attempt.";

export const ROUTES: AgentRouteSpec[] = [
  {
    path: "/deals/{id}/execution",
    method: "patch",
    tool: "set_deal_execution_status",
    summary:
      "Request that a confirmed (Won) deal's delivery status becomes IN_EXECUTION or COMPLETED. Waits for human approval (202); the dates are stamped by the server." +
      REFUSALS,
    requestSchema: S.setDealExecutionStatusBodySchema,
    responseSchema: S.dealChangeResponseSchema,
  },
  {
    path: "/deals/{id}/won-value",
    method: "patch",
    tool: "update_deal_won_value",
    summary:
      "Request a correction to a Won deal's final value (INR), expected start date or note. Waits for human approval (202)." +
      REFUSALS,
    requestSchema: S.updateDealWonValueBodySchema,
    responseSchema: S.dealChangeResponseSchema,
  },
  {
    path: "/broadcasts",
    method: "post",
    tool: "draft_broadcast",
    summary:
      "Create a DRAFT campaign (nothing is sent). Recipients are saved contacts only: contactIds (max 200) or a groupId whose members are frozen now. Opted-out contacts and contacts without campaign consent are left out; the response says how many are eligible. Refused with over_recipient_cap, over_daily_cap (limits are in the response and in the Setting agent_campaign_limits; defaults 200 per campaign, 500 per day), no_eligible_recipients, or a template that is not approved. MARKETING templates are allowed because launching needs a person's approval." +
      REFUSALS,
    requestSchema: S.draftBroadcastBodySchema,
    responseSchema: S.draftBroadcastResponseSchema,
  },
  {
    path: "/broadcasts/{id}",
    method: "get",
    tool: "get_broadcast_status",
    summary: "Counters of one of your own campaigns (recipients, sent, delivered, read, failed) and its status. Other people's broadcasts return 404.",
    responseSchema: S.getBroadcastStatusResponseSchema,
  },
  {
    path: "/broadcasts/{id}/pause",
    method: "post",
    tool: "pause_broadcast",
    summary:
      "Stop one of your own campaigns: a running one is asked to pause (the sender stops between recipients); a scheduled one goes back to draft. Safe to repeat." +
      REFUSALS,
    requestSchema: S.pauseBroadcastBodySchema,
    responseSchema: S.pauseBroadcastResponseSchema,
  },
  {
    path: "/broadcasts/{id}/launch",
    method: "post",
    tool: "launch_broadcast",
    summary:
      "Request that a draft campaign is sent now. Always held for a person (202 with approvalId). When approved it re-checks opt-outs, campaign consent and the campaign limits first, and sends nothing if they no longer fit." +
      REFUSALS,
    requestSchema: S.launchBroadcastBodySchema,
    responseSchema: S.launchBroadcastResponseSchema,
  },
  {
    path: "/broadcasts/{id}/schedule",
    method: "post",
    tool: "schedule_broadcast",
    summary:
      "Request that a draft campaign is sent later (scheduledAt between 2 minutes and 90 days from now). Always held for a person (202). When approved it re-checks opt-outs, consent and the limits for that day." +
      REFUSALS,
    requestSchema: S.scheduleBroadcastBodySchema,
    responseSchema: S.scheduleBroadcastResponseSchema,
  },
];

// Loaded on demand: the approval runner is the only caller, and keeping the
// campaign code out of this module's imports keeps the permission table (which
// imports every registry) light and free of import cycles.
const lazy =
  (name: "setDealExecutionStatusExecutor" | "updateDealWonValueExecutor" | "launchBroadcastExecutor" | "scheduleBroadcastExecutor"): ApprovalExecutor =>
  async (args) => (await import("../deals/executors"))[name](args);

/** Runners for the APPROVAL tools above, called once with the stored input after a person approves. */
export const EXECUTORS: Record<string, ApprovalExecutor> = {
  set_deal_execution_status: lazy("setDealExecutionStatusExecutor"),
  update_deal_won_value: lazy("updateDealWonValueExecutor"),
  launch_broadcast: lazy("launchBroadcastExecutor"),
  schedule_broadcast: lazy("scheduleBroadcastExecutor"),
};
