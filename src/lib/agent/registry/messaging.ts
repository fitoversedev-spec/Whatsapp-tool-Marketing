import type { ToolDefinition } from "../permissions";
import type { AgentRouteSpec } from "../openapi";
import { AgentHttpError } from "../errors";
import type { ApprovalExecutor } from "../executors";
import {
  consentOffBody,
  consentOffResponseSchema,
  eligibilityResponseSchema,
  getEventsResponseSchema,
  getMessagesResponseSchema,
  listConversationsResponseSchema,
  listTemplatesResponseSchema,
  optOutResponseSchema,
  recordOptOutBody,
  sendMarketingTemplateBody,
  sendReplyBody,
  sendTemplateBody,
  sentMessageResponseSchema,
} from "../schemas/messaging";

// Stage 3: messaging tools. Verdicts live here, in code; an admin can only
// make them stricter (see permissions.ts).
export const TOOLS: Record<string, ToolDefinition> = {
  list_conversations: { default: "ALLOWED", action: "read" },
  get_messages: { default: "ALLOWED", action: "read" },
  get_events: { default: "ALLOWED", action: "read" },
  get_send_eligibility: { default: "ALLOWED", action: "read" },
  list_templates: { default: "ALLOWED", action: "read" },
  // Free text inside the 24 h window. Prices, discounts and promises in the text
  // are held for a human by the handler itself (approval_requested, 202).
  send_reply: { default: "ALLOWED", action: "send" },
  // UTILITY templates only; MARKETING is refused here and goes through the tool below.
  send_template: { default: "ALLOWED", action: "send" },
  send_marketing_template: { default: "APPROVAL", action: "send", neverLoosen: true },
  // Both can only make a contact MORE restricted.
  record_opt_out: { default: "ALLOWED", action: "update" },
  set_campaign_consent_false: { default: "ALLOWED", action: "update" },
  // No route exists. Registered so the permission table states it plainly.
  resubscribe_contact: { default: "NEVER", action: "update", neverLoosen: true },
};

const REFUSALS =
  " Refusals come back as { error: { code, message } } and are stored against the Idempotency-Key: use a new key for each new attempt.";

export const ROUTES: AgentRouteSpec[] = [
  {
    path: "/conversations",
    method: "get",
    tool: "list_conversations",
    summary:
      "List conversations where the customer has written to us, newest inbound first. Query: q (name or phone), status, limit (1-50, default 25), cursor. Each item shows the 24 h window state and the opt-out flag. Staff-only notes are never included.",
    responseSchema: listConversationsResponseSchema,
  },
  {
    path: "/conversations/{id}/messages",
    method: "get",
    tool: "get_messages",
    summary:
      "Message history of one conversation, oldest first within the page. Query: limit (1-100, default 50), before (ISO time of the oldest message you already have). Never marks anything as read.",
    responseSchema: getMessagesResponseSchema,
  },
  {
    path: "/conversations/{id}/messages",
    method: "post",
    tool: "send_reply",
    summary:
      "Send a free-text WhatsApp reply (max 1000 characters) to the conversation's own number. Refused with opted_out (never sent), window_closed (use send_template) or rate_limited (max 10 per conversation per hour by default). Text that mentions a price, discount, offer or commitment (delivery date, warranty, guarantee, deadline) is not sent: the response is 202 with an approvalId and reason needs_approval_price_or_commitment. The same text within 10 minutes returns the earlier message with duplicate: true." +
      REFUSALS,
    requestSchema: sendReplyBody,
    responseSchema: sentMessageResponseSchema,
  },
  {
    path: "/conversations/{id}/eligibility",
    method: "get",
    tool: "get_send_eligibility",
    summary:
      "Whether you may message this contact now: free text (24 h window, not opted out), UTILITY template, MARKETING template (needs campaign consent), and why not.",
    responseSchema: eligibilityResponseSchema,
  },
  {
    path: "/conversations/{id}/template-messages",
    method: "post",
    tool: "send_template",
    summary:
      "Send an approved UTILITY template to the conversation's own number, with one value per {{n}} placeholder (variables, in order). MARKETING templates are refused with use_marketing_tool; send those with send_marketing_template. Opted-out contacts are refused (opted_out). Variables that mention a price or promise are held for a human (202)." +
      REFUSALS,
    requestSchema: sendTemplateBody,
    responseSchema: sentMessageResponseSchema,
  },
  {
    path: "/marketing-template-messages",
    method: "post",
    tool: "send_marketing_template",
    summary:
      "Request a MARKETING template send. Always held for a human (202 with approvalId). Even once approved it is refused for opted-out contacts and for contacts without campaign consent. The conversationId is in the body so the approver sees the whole request.",
    requestSchema: sendMarketingTemplateBody,
    responseSchema: sentMessageResponseSchema,
  },
  {
    path: "/events",
    method: "get",
    tool: "get_events",
    summary:
      "New inbound WhatsApp messages and new leads (CRM leads and ad leads), oldest first. Query: since (ISO time, at most 7 days back) or cursor (from nextCursor of the previous response), types (message,lead), limit (1-200, default 100). Poll with the returned nextCursor.",
    responseSchema: getEventsResponseSchema,
  },
  {
    path: "/templates",
    method: "get",
    tool: "list_templates",
    summary:
      "Approved, non-deleted UTILITY and MARKETING templates with their body, placeholder numbers and which tool sends them. Query: category (UTILITY or MARKETING).",
    responseSchema: listTemplatesResponseSchema,
  },
  {
    path: "/contacts/opt-out",
    method: "post",
    tool: "record_opt_out",
    summary:
      "Record that a person asked to stop receiving messages (give phone or conversationId, and a reason). Safe to repeat: an existing opt-out is left untouched. There is no tool to undo an opt-out.",
    requestSchema: recordOptOutBody,
    responseSchema: optOutResponseSchema,
  },
  {
    path: "/contacts/consent-off",
    method: "post",
    tool: "set_campaign_consent_false",
    summary:
      "Turn campaign (marketing broadcast) consent off for a contact (give phone or conversationId). Safe to repeat. There is no tool to turn it back on.",
    requestSchema: consentOffBody,
    responseSchema: consentOffResponseSchema,
  },
];


// What runs when a person approves a request. The handler re-checks everything
// at send time (opted out, campaign consent, approved template, variables), so
// approval never overrides those rules. Loaded on demand to keep this registry light.
//
// send_reply / send_template are NOT listed: when held for a price or promise they
// would hit the same content guard again and queue a second request. They need an
// "already approved" path in messaging/send.ts first; until then an approved one is
// recorded as "approved, cannot be run automatically yet" and nothing is sent.
export const EXECUTORS: Record<string, ApprovalExecutor> = {
  send_marketing_template: async ({ ctx, input }) => {
    const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const parsed = sendMarketingTemplateBody.safeParse({
      conversationId: o.conversationId,
      templateId: o.templateId,
      variables: o.variables,
    });
    if (!parsed.success) {
      throw new AgentHttpError("invalid_input", "The saved request is no longer valid, so it was not run.");
    }
    const { sendMarketingTemplateHandler } = await import("../messaging/send");
    const result = await sendMarketingTemplateHandler({
      ctx,
      input: parsed.data,
      params: {},
      idempotencyKey: null,
    } as unknown as Parameters<typeof sendMarketingTemplateHandler>[0]);
    return { status: result.status ?? 200, body: result.body, recordIds: result.recordIds };
  },
};
