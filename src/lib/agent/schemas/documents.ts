import { z } from "zod/v4";
import { SUPPORTED_SPORTS, type Sport } from "@/lib/quotation/rates";

/**
 * Request and response shapes for the court-design tools (stage 6). The
 * pictures are drawn in a person's browser, so nothing here accepts a picture,
 * a layout or a phone number: a design is found through the customer, and sent
 * to the phone on its own record.
 *
 * "Approved documents" (the owner has not decided yet) are not part of this file.
 */

const id = () => z.string().uuid();
const exactlyOneCustomer = (b: { leadId?: unknown; conversationId?: unknown }) =>
  (b.leadId ? 1 : 0) + (b.conversationId ? 1 : 0) === 1;
const ONE_CUSTOMER = { message: "Provide exactly one of leadId or conversationId." };

export const DESIGN_LIST_DEFAULT_LIMIT = 10;
export const DESIGN_LIST_MAX_LIMIT = 25;
export const MIN_PLOT_FT = 10;
export const MAX_PLOT_FT = 2000;

export const designSportSchema = z.enum(SUPPORTED_SPORTS as [Sport, ...Sport[]]);
export const designFormatSchema = z.enum(["2d", "3d-image", "3d-video"]);

const customerQuery = {
  leadId: id().optional().describe("The CRM lead (contact) id."),
  conversationId: id().optional().describe("The WhatsApp conversation id."),
};

export const listDesignsQuery = z
  .object({
    ...customerQuery,
    limit: z.coerce.number().int().min(1).max(DESIGN_LIST_MAX_LIMIT).default(DESIGN_LIST_DEFAULT_LIMIT),
  })
  .refine(exactlyOneCustomer, ONE_CUSTOMER);

export const getDesignQuery = z.object(customerQuery).refine(exactlyOneCustomer, ONE_CUSTOMER);

export const createDesignDraftBodySchema = z
  .strictObject({
    ...customerQuery,
    sport: designSportSchema,
    lengthFt: z.number().min(MIN_PLOT_FT).max(MAX_PLOT_FT),
    widthFt: z.number().min(MIN_PLOT_FT).max(MAX_PLOT_FT),
    title: z.string().trim().min(1).max(120).optional().describe("Optional name shown on the design."),
  })
  .refine(exactlyOneCustomer, ONE_CUSTOMER);

export const sendDesignBodySchema = z.strictObject({
  formats: z
    .array(designFormatSchema)
    .min(1)
    .max(3)
    .refine((f) => new Set(f).size === f.length, { message: "List each format once." })
    .describe("Which saved pictures to send: 2d plan, 3d-image, 3d-video. Only formats that already exist on the design."),
});

const designFormatsSchema = z.object({
  twoD: z.boolean(),
  threeDImage: z.boolean(),
  threeDVideo: z.boolean(),
});

export const designSchema = z.object({
  id: z.string(),
  number: z.string(),
  customerName: z.string(),
  status: z.string().describe("draft or sent."),
  sports: z.array(z.string()),
  plot: z.object({ lengthFt: z.number(), widthFt: z.number() }).nullable().describe("Only on get_design."),
  formats: designFormatsSchema.describe("Which pictures exist. A format that is false cannot be sent."),
  needsDrawing: z.boolean().describe("True when no picture exists yet: a team member has to draw it."),
  createdBy: z.enum(["ai_agent", "staff"]),
  dealId: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const listDesignsResponseSchema = z.object({ designs: z.array(designSchema) });
export const getDesignResponseSchema = z.object({ design: designSchema });
export const createDesignDraftResponseSchema = z.object({
  design: designSchema,
  note: z.string(),
});
export const sendDesignResponseSchema = z.object({
  sent: z.boolean(),
  duplicate: z.boolean().describe("True when every requested picture was already sent to this chat in the last 10 minutes."),
  formatsSent: z.array(designFormatSchema),
  skippedDuplicateFormats: z.array(designFormatSchema),
  mirrored: z.number().int().describe("Messages saved to the inbox thread."),
});
