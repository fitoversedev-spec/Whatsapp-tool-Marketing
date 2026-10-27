import { z } from "zod/v4";
import { blankToUndefined, dateRangeRefine, DATE_RANGE_MSG, dayParam, limitParam, pageParam, text as queryText } from "./read";

/**
 * Request and response shapes for the website-lead tools (leads that arrive from
 * the fitoverse.com court configurator). They mirror the ad-lead tools:
 *   - the list takes query-string filters and a page of at most 100 rows;
 *   - each mutating tool has <tool>BodySchema (what the caller sends, published
 *     in the OpenAPI document) and <tool>InputSchema (the body plus the id from
 *     the URL, copied in by withPathIds so an approval would keep it);
 *   - every body is strict: an unknown key is an error, never silently dropped.
 *
 * The responses are deliberately narrower than the database row: no normalised
 * phone, no user-agent, no website-side ids, no internal user ids.
 */

const iso = z.string().describe("ISO 8601 timestamp");
const bodyText = (max: number) => z.string().trim().min(1).max(max);

/** Court size filter: a whole number of square feet. Blank counts as absent. */
const areaParam = z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(100_000_000).optional());

// ── list_website_leads ──────────────────────────────────────────────────────

export const websiteLeadsQuerySchema = z
  .object({
    from: dayParam,
    to: dayParam,
    city: queryText(100),
    sport: queryText(100),
    areaMin: areaParam,
    areaMax: areaParam,
    stage: queryText(60),
    assigned: queryText(100),
    label: queryText(100),
    q: queryText(100),
    limit: limitParam,
    page: pageParam,
  })
  .refine(dateRangeRefine, DATE_RANGE_MSG)
  .refine((v) => v.areaMin == null || v.areaMax == null || v.areaMin <= v.areaMax, {
    message: "areaMin must not be above areaMax",
    path: ["areaMin"],
  });
export type WebsiteLeadsInput = z.infer<typeof websiteLeadsQuerySchema>;

export const websiteLeadBadgeSchema = z.object({
  kind: z.enum(["crm", "ad_lead", "whatsapp"]),
  label: z.string(),
  id: z.string().describe("The matching CRM contact, ad lead or WhatsApp contact"),
});

export const websiteLeadRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  sport: z.string().nullable(),
  size: z.object({
    areaSqft: z.number().int().nullable(),
    lengthFt: z.number().int().nullable(),
    widthFt: z.number().int().nullable(),
  }),
  startTime: z.string().nullable().describe("When the customer wants to start, as they chose it on the form"),
  stage: z.string().describe("A lead stage slug (see adLeadStages in get_crm_meta)"),
  labels: z.array(z.string()),
  assignedTo: z.string().nullable().describe("Name of the sales rep, or null when unassigned"),
  inCrm: z.boolean(),
  receivedAt: iso,
  badges: z.array(websiteLeadBadgeSchema).describe("Same person found elsewhere: already in the CRM, also an ad lead, a WhatsApp contact"),
});
export type WebsiteLeadRow = z.infer<typeof websiteLeadRowSchema>;

export const websiteLeadsResponseSchema = z.object({
  items: z.array(websiteLeadRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageCount: z.number().int(),
  limit: z.number().int(),
});

// ── get_website_lead ────────────────────────────────────────────────────────

export const websiteLeadDetailSchema = websiteLeadRowSchema.extend({
  jobTitle: z.string().nullable(),
  customerMessage: z.string().nullable().describe("What the customer wrote on the form"),
  formAnswers: z.array(z.object({ name: z.string(), value: z.string() })).describe("Answers to the form's questions"),
  surface: z.string().nullable(),
  courtEnvironment: z.string().nullable().describe("The kind of venue chosen in the court configurator (school, academy, ...)"),
  inMarketing: z.boolean().describe("Already added to the WhatsApp marketing contacts"),
  notes: z
    .array(z.object({ id: z.string(), body: z.string(), author: z.string(), createdAt: iso }))
    .describe("Reps' and the AI's notes, newest first"),
});

// ── write tools ─────────────────────────────────────────────────────────────

/** The published body schema and the internal input schema (body + the id from the URL), from one shape. */
function build<S extends z.ZodRawShape>(shape: S) {
  return {
    body: z.strictObject(shape),
    input: z.strictObject({ websiteLeadId: z.string().uuid(), ...shape }),
  };
}

const stage = build({ stage: bodyText(100).describe("A lead stage slug (an active one; the same list as ad leads).") });
export const setWebsiteLeadStageBodySchema = stage.body;
export const setWebsiteLeadStageInputSchema = stage.input;

export const WEBSITE_LEAD_NOTE_MAX = 5000;
const note = build({ body: bodyText(WEBSITE_LEAD_NOTE_MAX) });
export const addWebsiteLeadNoteBodySchema = note.body;
export const addWebsiteLeadNoteInputSchema = note.input;

const move = build({});
export const moveWebsiteLeadBodySchema = move.body;
export const moveWebsiteLeadInputSchema = move.input;

export const websiteLeadStageResponseSchema = z.object({ id: z.string(), stage: z.string() });

export const websiteLeadNoteResponseSchema = z.object({ note: z.object({ id: z.string(), createdAt: z.string() }) });

export const moveWebsiteLeadResponseSchema = z.object({
  accountContactId: z.string().nullable().describe("The CRM contact the lead is now linked to"),
  alreadyLinked: z.boolean().describe("true when the lead had already been moved"),
  matchedExisting: z.boolean().describe("true when an existing CRM contact with the same phone was reused"),
});
