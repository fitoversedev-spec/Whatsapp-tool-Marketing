import { z } from "zod/v4";

/**
 * Input and response shapes for the AI → human handoff tools. Inputs are strict
 * objects, like the other agent schemas.
 */
const recordId = z.string().min(1).max(64);

export const requestHumanHandoffBody = z.strictObject({
  /** Why the customer wants a person, in a line (e.g. "wants to discuss pricing on a call"). */
  reason: z.string().trim().min(3).max(500),
  /** The requirements gathered so far, so the salesperson does not have to ask again. */
  summary: z.string().trim().max(5000).default(""),
  /** The CRM lead (AccountContact) if the AI already knows it; otherwise it is found by phone. */
  leadId: recordId.optional(),
});

export const requestHumanHandoffInputSchema = requestHumanHandoffBody.extend({ conversationId: recordId });

const handoffDto = z.object({
  id: z.string(),
  conversationId: z.string(),
  leadId: z.string().nullable(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "RELEASED"]),
  reason: z.string(),
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  assignedTo: z.object({ userId: z.string(), name: z.string() }).nullable(),
});

const aiModeDto = z.object({
  mode: z.enum(["ai", "waiting_for_human", "human"]),
  canReply: z.boolean(),
  reason: z.enum(["no_handoff", "holding_reply_allowed", "customer_wrote_again", "waiting_for_customer", "human_assigned"]),
});

export const requestHumanHandoffResponseSchema = z.object({
  requested: z.boolean(),
  deduplicated: z.boolean(),
  handoff: handoffDto,
  ai: aiModeDto,
});

export const aiStatusResponseSchema = z.object({
  conversationId: z.string(),
  ai: aiModeDto,
  handoff: handoffDto.nullable(),
});
