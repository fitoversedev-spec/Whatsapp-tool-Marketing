import type { ToolDefinition } from "../permissions";
import type { AgentRouteSpec } from "../openapi";
import { approvalStatusResponseSchema } from "../schemas/approvals";

// Stage 5: the AI can look up how its own approval requests are going. There is
// deliberately no tool to approve, reject or edit one: only people decide, in the
// CRM (see approvalRunner.ts).
export const TOOLS: Record<string, ToolDefinition> = {
  get_approval_status: { default: "ALLOWED", action: "read" },
};

export const ROUTES: AgentRouteSpec[] = [
  {
    path: "/approvals/{id}",
    method: "get",
    tool: "get_approval_status",
    summary:
      "Status of an approval request this key's AI made (the approvalId from a 202 response): pending, executed, failed, rejected or expired, with the decision note and, once it ran, the result. Requests made by anyone else return 404. Poll gently (every 30-60 seconds at most).",
    responseSchema: approvalStatusResponseSchema,
  },
];
