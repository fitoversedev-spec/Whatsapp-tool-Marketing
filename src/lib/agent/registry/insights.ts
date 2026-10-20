import type { ToolDefinition } from "../permissions";
import type { AgentRouteSpec } from "../openapi";
import * as S from "../schemas/insights";

// Lead temperature for the AI agent chats page. Only ever a label: it sends nothing.
export const TOOLS: Record<string, ToolDefinition> = {
  set_lead_temperature: { default: "ALLOWED", action: "update" },
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
];
