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
      "The customer asked to talk to a person. Files a request that an admin approves by assigning a salesperson. Send reason and summary (the requirements gathered so far). After this, until an admin decides: you may send ONE holding reply, then only reply when the customer writes again (send tools return 409 waiting_for_customer otherwise). Once a salesperson is assigned they call the customer from their own phone; you keep answering product and technical questions (see get_ai_status guidance). Asking again while a request is open returns it with deduplicated: true.",
    requestSchema: S.requestHumanHandoffBody,
    responseSchema: S.requestHumanHandoffResponseSchema,
  },
  {
    path: "/conversations/{id}/ai-status",
    method: "get",
    tool: "get_ai_status",
    summary:
      "Whether and how the AI may message this chat now. mode: ai (normal), waiting_for_human (the customer asked for a person and an admin is deciding; canReply is true only when the customer spoke last), sales_assigned (a salesperson owns the lead and calls from their own phone; keep answering product/technical questions, leave price, quotes, discounts and visits to them — follow `guidance`, which also says if you still need to introduce the salesperson). Call this before replying.",
    responseSchema: S.aiStatusResponseSchema,
  },
];
