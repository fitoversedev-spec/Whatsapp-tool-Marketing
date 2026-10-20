import type { ToolDefinition } from "../permissions";
import type { AgentRouteSpec } from "../openapi";
import * as S from "../schemas/insights";

// Lead temperature for the AI agent chats page (a label; sends nothing), and the
// first message to a new lead-form lead.
export const TOOLS: Record<string, ToolDefinition> = {
  set_lead_temperature: { default: "ALLOWED", action: "update" },
  // Only admin-chosen welcome templates, once per lead, never to opted-out numbers.
  start_lead_conversation: { default: "ALLOWED", action: "send" },
};

export const ROUTES: AgentRouteSpec[] = [
  {
    path: "/conversations/{id}/temperature",
    method: "post",
    tool: "set_lead_temperature",
    summary:
      "Label this chat HOT, WARM or COLD with a one-line reason; shown on WhatsApp Marketing → AI agent chats. Use HOT for clear buying intent (budget or timeline confirmed, wants a quote, call or site visit), WARM for interested but undecided, COLD for no interest. Update it as the chat develops. A label set by a person is kept (applied: false).",
    requestSchema: S.setLeadTemperatureBody,
    responseSchema: S.setLeadTemperatureResponseSchema,
  },
  {
    path: "/ads/leads/{id}/conversation",
    method: "post",
    tool: "start_lead_conversation",
    summary:
      "First WhatsApp message to a new Meta lead-form lead (Instagram/Facebook instant form; get_events type lead, source ad). Sends one of the admin's welcome templates (templateId optional: the first by default; variables optional: {{1}} = first name) and returns the conversationId; from then on use the normal messaging tools. Once per lead (a repeat returns deduplicated: true). Refused: opted_out, no_phone, no_welcome_template, template_not_allowed, already_chatting (the customer is already messaging: reply in that conversationId instead).",
    requestSchema: S.startLeadConversationBody,
    responseSchema: S.startLeadConversationResponseSchema,
  },
];
