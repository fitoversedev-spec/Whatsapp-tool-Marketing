import type { ToolDefinition } from "../permissions";
import type { AgentRouteSpec } from "../openapi";
import * as S from "../schemas/documents";

// Stage 6 (court designs). The pictures are drawn in a person's browser, so the
// AI cannot create pictures: it can find a customer's designs, start an empty
// draft for a team member to draw, and send pictures that already exist.
//
// "Approved documents" (quotations, PDFs, ...) are deliberately NOT here: the
// owner will decide those later.
export const TOOLS: Record<string, ToolDefinition> = {
  list_designs: { default: "ALLOWED", action: "read" },
  get_design: { default: "ALLOWED", action: "read" },
  create_design_draft: { default: "ALLOWED", action: "create" },
  send_design: { default: "ALLOWED", action: "send" },
  // No route exists for either. Registered so the permission table states it plainly.
  email_design_any_address: { default: "NEVER", action: "send", neverLoosen: true },
  send_design_combined_pdf_unchecked: { default: "NEVER", action: "send", neverLoosen: true },
};

const REFUSALS =
  " Refusals come back as { error: { code, message } } and are stored against the Idempotency-Key: use a new key for each new attempt.";

export const ROUTES: AgentRouteSpec[] = [
  {
    path: "/court-designs",
    method: "get",
    tool: "list_designs",
    summary:
      "List a customer's court designs (give leadId or conversationId; limit 1-25, default 10), newest first: number, sports, status and which pictures exist (2D plan, 3D image, 3D video). Only designs linked to that customer; no layout and no picture links.",
    responseSchema: S.listDesignsResponseSchema,
  },
  {
    path: "/court-designs",
    method: "post",
    tool: "create_design_draft",
    summary:
      "Start an EMPTY draft design for a customer (leadId or conversationId) from a sport and the plot size in feet. It carries no pictures: a team member must draw it in the Court Designer before it can be sent. No picture, layout or phone is accepted." +
      REFUSALS,
    requestSchema: S.createDesignDraftBodySchema,
    responseSchema: S.createDesignDraftResponseSchema,
  },
  {
    path: "/court-designs/{id}",
    method: "get",
    tool: "get_design",
    summary:
      "One court design: sports, plot size and which pictures exist. Give the same leadId or conversationId you listed it with; a design that is not that customer's returns 404.",
    responseSchema: S.getDesignResponseSchema,
  },
  {
    path: "/court-designs/{id}/send",
    method: "post",
    tool: "send_design",
    summary:
      "Send a design's existing pictures (formats: 2d, 3d-image, 3d-video) to the customer on WhatsApp, to the number on the design's own conversation or contact (never one you supply). Refused with opted_out (never sent), window_closed (the 24 h window is shut; a team member sends it instead), format_missing (that picture does not exist) or phone_mismatch. A picture already sent to this chat in the last 10 minutes is skipped." +
      REFUSALS,
    requestSchema: S.sendDesignBodySchema,
    responseSchema: S.sendDesignResponseSchema,
  },
];
