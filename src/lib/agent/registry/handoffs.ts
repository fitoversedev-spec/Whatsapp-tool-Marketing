import type { ToolDefinition } from "../permissions";
import type { AgentRouteSpec } from "../openapi";
import * as S from "../schemas/handoffs";

// AI → human handoff. Asking for a person is always allowed (the human decision
// happens afterwards, on the AI handoffs screen); checking the chat's state is a read.
export const TOOLS: Record<string, ToolDefinition> = {
  request_human_handoff: { default: "ALLOWED", action: "create", group: "escalate" },
  get_ai_status: { default: "ALLOWED", action: "read" },
};

export const ROUTES: AgentRouteSpec[] = [
  {
    path: "/conversations/{id}/handoff",
    method: "post",
    tool: "request_human_handoff",
    summary:
      "The customer asked to talk to a person. Files a request that an admin approves by assigning a salesperson. Send reason and summary (the requirements gathered so far). After this, until an admin decides: you may send ONE holding reply, then only reply when the customer writes again (send tools return 409 waiting_for_customer otherwise). Once a salesperson is assigned the AI must stay silent in this chat (409 human_assigned) until it is handed back. Asking again while a request is open returns it with deduplicated: true.",
    requestSchema: S.requestHumanHandoffBody,
    responseSchema: S.requestHumanHandoffResponseSchema,
  },
  {
    path: "/conversations/{id}/ai-status",
    method: "get",
    tool: "get_ai_status",
    summary:
      "Whether the AI may message this chat now. mode: ai (normal), waiting_for_human (a handoff request is pending; canReply is true only when the customer spoke last), human (a salesperson has taken over; never reply). Call this before replying.",
    responseSchema: S.aiStatusResponseSchema,
  },
];
