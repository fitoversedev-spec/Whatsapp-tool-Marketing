import { z } from "zod/v4";

/**
 * Input and response shapes for the messaging tools (stage 3). Routes validate
 * with the input schemas; openapi.ts publishes the response schemas.
 * Inputs are strict objects: an unexpected key (say a `to` phone number on
 * send_reply) is a 400, never silently ignored.
 */
const isoDateTime = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO 8601 date-time");
const recordId = z.string().min(1).max(64);
const cursor = z.string().min(1).max(400);

// ---- reads (query strings) -------------------------------------------------

export const listConversationsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: cursor.optional(),
});

export const getMessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: isoDateTime.optional(),
});

export const getEventsQuery = z
  .object({
    since: isoDateTime.optional(),
    cursor: cursor.optional(),
    types: z.string().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .refine((v) => !!v.since || !!v.cursor, "Provide `since` (ISO 8601) or a `cursor` from a previous response.");

export const listTemplatesQuery = z.object({
  category: z.enum(["UTILITY", "MARKETING"]).optional(),
});

// ---- writes (JSON bodies) --------------------------------------------------

export const sendReplyBody = z.strictObject({
  text: z.string().trim().min(1).max(1000),
  /** Opaque label from the caller (a task or ticket id); echoed back, not sent to the customer. */
  reference: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._:-]+$/)
    .optional(),
});

const templateVariables = z.array(z.string().max(1000)).max(20).default([]);

export const sendTemplateBody = z.strictObject({
  templateId: recordId,
  variables: templateVariables,
});

export const sendMarketingTemplateBody = z.strictObject({
  conversationId: recordId,
  templateId: recordId,
  variables: templateVariables,
});

const exactlyOneTarget = (b: { phone?: string; conversationId?: string }) =>
  (b.phone ? 1 : 0) + (b.conversationId ? 1 : 0) === 1;

export const recordOptOutBody = z
  .strictObject({
    phone: z.string().trim().min(7).max(20).optional(),
    conversationId: recordId.optional(),
    reason: z.string().trim().min(1).max(200),
  })
  .refine(exactlyOneTarget, "Provide exactly one of `phone` or `conversationId`.");

export const consentOffBody = z
  .strictObject({
    phone: z.string().trim().min(7).max(20).optional(),
    conversationId: recordId.optional(),
  })
  .refine(exactlyOneTarget, "Provide exactly one of `phone` or `conversationId`.");

// ---- responses -------------------------------------------------------------

export const conversationSummarySchema = z.object({
  id: z.string(),
  contactName: z.string().nullable(),
  phone: z.string(),
  status: z.string(),
  unreadCount: z.number().int(),
  lastInboundAt: z.string().nullable(),
  lastOutboundAt: z.string().nullable(),
  lastMessageAt: z.string().nullable(),
  windowOpen: z.boolean(),
  windowEndsAt: z.string().nullable(),
  optedOut: z.boolean(),
  assignedToHuman: z.boolean(),
});

export const listConversationsResponseSchema = z.object({
  conversations: z.array(conversationSummarySchema),
  nextCursor: z.string().nullable(),
});

export const messageSchema = z.object({
  id: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  type: z.string(),
  body: z.string().nullable(),
  mediaMimeType: z.string().nullable(),
  mediaFileName: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  sentBy: z
    .enum(["ai_agent", "staff", "system"])
    .nullable()
    .describe("Outbound only: ai_agent = sent by you, staff = a team member, system = automation."),
  templateId: z.string().nullable(),
});

export const getMessagesResponseSchema = z.object({
  conversationId: z.string(),
  windowOpen: z.boolean(),
  hasMore: z.boolean(),
  nextBefore: z.string().nullable().describe("Pass as `before` to load older messages; null when none are left."),
  messages: z.array(messageSchema).describe("Oldest first."),
});

export const eventSchema = z.object({
  type: z.enum(["message", "lead"]),
  id: z.string(),
  at: z.string(),
  source: z.enum(["whatsapp", "crm", "ad"]),
  conversationId: z.string().optional(),
  messageType: z.string().optional(),
  body: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  sport: z.string().nullable().optional(),
  campaignName: z.string().nullable().optional(),
});

export const getEventsResponseSchema = z.object({
  events: z.array(eventSchema).describe("Oldest first."),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable().describe("Pass as `cursor` next time; null when no event was returned."),
  serverTime: z.string(),
});

export const eligibilityResponseSchema = z.object({
  conversationId: z.string(),
  canReplyFreeText: z.boolean(),
  windowOpen: z.boolean(),
  windowEndsAt: z.string().nullable(),
  optedOut: z.boolean(),
  allowCampaign: z.boolean().nullable().describe("null = no marketing contact record, i.e. no campaign consent on file."),
  canSendUtilityTemplate: z.boolean(),
  canSendMarketingTemplate: z.boolean(),
  reasonIfNot: z.enum(["opted_out", "window_closed"]).nullable(),
});

export const templateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string(),
  category: z.string(),
  body: z.string(),
  variables: z.array(z.number().int()).describe("Placeholder numbers; supply one value for each, in order."),
  variableCount: z.number().int(),
  usableWith: z.enum(["send_template", "send_marketing_template"]),
});

export const listTemplatesResponseSchema = z.object({ templates: z.array(templateSummarySchema) });

export const sentMessageResponseSchema = z.object({
  sent: z.boolean(),
  duplicate: z.boolean().describe("true: the same text was already sent in the last 10 minutes; nothing new was sent."),
  mirrored: z.boolean().describe("false: WhatsApp accepted the message but it could not be saved to the inbox history."),
  waMessageId: z.string().nullable(),
  reference: z.string().nullable(),
  message: messageSchema.nullable(),
});

export const optOutResponseSchema = z.object({
  phone: z.string(),
  optedOut: z.literal(true),
  alreadyOptedOut: z.boolean(),
});

export const consentOffResponseSchema = z.object({
  phone: z.string(),
  allowCampaign: z.literal(false),
  created: z.boolean().describe("true when no marketing contact existed and one was created with consent off."),
});
