import { z } from "zod/v4";

/** set_lead_temperature: the AI's own hot / warm / cold call on a chat. */
export const setLeadTemperatureBody = z.strictObject({
  temperature: z.enum(["HOT", "WARM", "COLD"]),
  /** Why, in a line (e.g. "budget 25 L confirmed, wants to start this month"). */
  reason: z.string().trim().min(3).max(500),
});

export const setLeadTemperatureResponseSchema = z.object({
  conversationId: z.string(),
  applied: z.boolean(),
  temperature: z.enum(["HOT", "WARM", "COLD"]),
  source: z.enum(["agent", "human"]),
  message: z.string().optional(),
});

/** start_lead_conversation: first WhatsApp template to a Meta lead-form lead. */
export const startLeadConversationBody = z.strictObject({
  /** One of the admin's welcome templates; the first one when omitted. */
  templateId: z.string().min(1).max(64).optional(),
  /** Template variables; when omitted, {{1}} is the lead's first name. */
  variables: z.array(z.string().max(200)).max(10).optional(),
});

export const startLeadConversationResponseSchema = z.object({
  sent: z.boolean(),
  deduplicated: z.boolean(),
  /** Why nothing was sent: a salesperson already owns the customer, or this person was already welcomed / contacted. */
  skipped: z.enum(["already_assigned", "already_welcomed", "contacted_recently"]).optional(),
  assignedTo: z.object({ name: z.string(), source: z.string() }).optional(),
  conversationId: z.string().nullable(),
  templateId: z.string().nullable(),
  text: z.string().optional(),
});
