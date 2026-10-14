import { z } from "zod/v4";
import { normalizePhone } from "@/lib/phone";
import {
  checkDueAt,
  CUSTOM_FIELD_KEY_RE,
  ESCALATION_TARGETS,
  isReservedFieldKey,
  MAX_CUSTOM_FIELDS_PER_CALL,
} from "../leads/logic";

/**
 * Request and response shapes for the lead tools. Each tool has:
 *   <tool>BodySchema   what the caller sends (published in the OpenAPI document)
 *   <tool>InputSchema  what withAgent validates: the body plus the id from the
 *                      URL, which the route copies into the body first (see
 *                      leads/pathIds.ts) so an approval request keeps it.
 * Every object is strict: an unknown key (say `phone` sent to
 * update_lead_details) is an error, never silently dropped.
 */

const id = () => z.string().uuid();
const text = (max: number, min = 1) => z.string().trim().min(min).max(max);

const phone = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .refine((v) => normalizePhone(v) !== null, { message: "Not a valid phone number (7-15 digits, optional +country code)." });

const email = z.string().trim().max(200).email();
const businessType = z.enum(["B2B", "B2C", "B2G"]);

/** A task or follow-up date: in the future, no further out than 180 days. */
const dueAt = z
  .string()
  .datetime({ offset: true })
  .superRefine((value, ctx) => {
    const problem = checkDueAt(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

export const customFieldsSchema = z
  .record(
    z.string().regex(CUSTOM_FIELD_KEY_RE, "Field names are 1-60 characters: letters, digits, space and _ . - / ( )."),
    z.string().max(500),
  )
  .refine((o) => Object.keys(o).length <= MAX_CUSTOM_FIELDS_PER_CALL, {
    message: `At most ${MAX_CUSTOM_FIELDS_PER_CALL} custom fields per request.`,
  })
  .refine((o) => Object.keys(o).every((k) => !isReservedFieldKey(k)), {
    message: 'Field names starting with "agent." are reserved for set_requirements.',
  });

/** Builds the published body schema and the internal input schema from one shape. */
function build<K extends string, S extends z.ZodRawShape>(idKey: K, shape: S) {
  return {
    body: z.strictObject(shape),
    input: z.strictObject({ [idKey]: id(), ...shape } as Record<K, z.ZodString> & S),
  };
}

const hasAny = (o: Record<string, unknown>) => Object.values(o).some((v) => v !== undefined);

// ── create_lead ─────────────────────────────────────────────────────────────

const createLeadShape = {
  name: text(200),
  phone,
  email: email.optional(),
  designation: text(200).optional(),
  companyName: text(200).optional().describe("Company or organisation. Defaults to the person's name."),
  city: text(100).optional(),
  businessType: businessType.optional(),
  notes: text(2000).optional().describe("What this lead wants."),
  customFields: customFieldsSchema.optional(),
  confirmNotDuplicate: z
    .boolean()
    .optional()
    .describe("Set true, together with duplicateReason, to create despite a possible duplicate (a 409 lists the matches)."),
  duplicateReason: text(300, 3).optional().describe("Why this is a different lead from the listed matches."),
};
// create_lead has no id in its path, so body and input are the same schema.
export const createLeadBodySchema = z.strictObject(createLeadShape).superRefine((o, ctx) => {
  if (o.confirmNotDuplicate === true && !o.duplicateReason) {
    ctx.addIssue({ code: "custom", path: ["duplicateReason"], message: "duplicateReason is required with confirmNotDuplicate." });
  }
});
export const createLeadInputSchema = createLeadBodySchema;

// ── update_lead_details ─────────────────────────────────────────────────────

const updateDetailsShape = {
  name: text(200).optional(),
  designation: text(200).nullable().optional(),
  email: email.nullable().optional(),
  city: text(100).nullable().optional(),
  businessType: businessType.nullable().optional(),
  customerProfileId: id().nullable().optional().describe("Customer segment id."),
  notes: text(2000).nullable().optional().describe('"What this lead wants". Replaces the existing text; use add_note to append.'),
  customFields: customFieldsSchema
    .optional()
    .describe("Merged into the lead's existing custom fields (keys you omit are kept); a value of \"\" clears a key."),
};
const updateDetails = build("leadId", updateDetailsShape);
const NEED_ONE_FIELD = { message: "Send at least one field to change." };
export const updateLeadDetailsBodySchema = updateDetails.body.refine(hasAny, NEED_ONE_FIELD);
export const updateLeadDetailsInputSchema = updateDetails.input.refine((o) => hasAny({ ...o, leadId: undefined }), NEED_ONE_FIELD);

// ── update_lead_phone (approval) ────────────────────────────────────────────

const updatePhone = build("leadId", {
  phone,
  reason: text(300).optional().describe("Why the number is changing; shown to the approver."),
});
export const updateLeadPhoneBodySchema = updatePhone.body;
export const updateLeadPhoneInputSchema = updatePhone.input;

// ── set_requirements ────────────────────────────────────────────────────────

const requirementsShape = {
  sport: text(60, 2).nullable().optional(),
  budgetInr: z.number().int().min(100).max(1_000_000_000).nullable().optional().describe("Budget in Indian rupees."),
  location: text(200, 2).nullable().optional().describe("Where the court will be built."),
  city: text(100, 2).nullable().optional(),
  courtLengthFt: z.number().min(1).max(1000).nullable().optional().describe("Length in feet."),
  courtWidthFt: z.number().min(1).max(1000).nullable().optional().describe("Width in feet."),
  surfacePreferences: z.array(text(60, 2)).max(10).nullable().optional(),
  timeline: text(100, 2).nullable().optional().describe('When they want it done, e.g. "within 2 months".'),
  b2bOrB2c: businessType.nullable().optional(),
  civilWorkNeeded: z.boolean().nullable().optional(),
  notes: text(1000).nullable().optional(),
};
const requirements = build("leadId", requirementsShape);
const NEED_ONE_REQUIREMENT = { message: "Send at least one requirement." };
export const setRequirementsBodySchema = requirements.body.refine(hasAny, NEED_ONE_REQUIREMENT);
export const setRequirementsInputSchema = requirements.input.refine((o) => hasAny({ ...o, leadId: undefined }), NEED_ONE_REQUIREMENT);

// ── set_lead_stage ──────────────────────────────────────────────────────────

const setStage = build("leadId", { stageId: id().describe("An active lead stage id.") });
export const setLeadStageBodySchema = setStage.body;
export const setLeadStageInputSchema = setStage.input;

// ── remove_from_leads (approval) ────────────────────────────────────────────

const removeFromLeads = build("leadId", { reason: text(500).describe("Why this should leave the Leads list.") });
export const removeFromLeadsBodySchema = removeFromLeads.body;
export const removeFromLeadsInputSchema = removeFromLeads.input;

// ── add_note ────────────────────────────────────────────────────────────────

const addNote = build("leadId", { title: text(200).optional(), body: text(5000) });
export const addNoteBodySchema = addNote.body;
export const addNoteInputSchema = addNote.input;

// ── save_conversation_summary ───────────────────────────────────────────────

const saveSummary = build("leadId", { summary: text(5000) });
export const saveSummaryBodySchema = saveSummary.body;
export const saveSummaryInputSchema = saveSummary.input;

// ── add_product_interest ────────────────────────────────────────────────────

const productInterest = build("leadId", {
  productIds: z.array(id()).max(30).default([]).describe("Catalogue product ids."),
  otherLabel: text(200).optional().describe("A product that is not in the catalogue."),
});
const NEED_A_PRODUCT = { message: "Send at least one productId or an otherLabel." };
const hasProduct = (o: { productIds: string[]; otherLabel?: string }) => o.productIds.length > 0 || !!o.otherLabel;
export const addProductInterestBodySchema = productInterest.body.refine(hasProduct, NEED_A_PRODUCT);
export const addProductInterestInputSchema = productInterest.input.refine(hasProduct, NEED_A_PRODUCT);

// ── assign_unassigned_lead / reassign_lead ──────────────────────────────────

const assign = build("leadId", {
  userId: id().describe("A salesperson or manager (active and approved)."),
  reason: text(300).optional(),
});
export const assignLeadBodySchema = assign.body;
export const assignLeadInputSchema = assign.input;

const reassign = build("leadId", {
  userId: id().describe("A salesperson or manager (active and approved)."),
  reason: text(300).describe("Why the lead should move; shown to the approver."),
});
export const reassignLeadBodySchema = reassign.body;
export const reassignLeadInputSchema = reassign.input;

// ── escalate_lead ───────────────────────────────────────────────────────────

const escalate = build("leadId", {
  target: z.enum(ESCALATION_TARGETS),
  reason: text(300),
  summary: text(2000).describe("What the human needs to know to pick this up."),
});
export const escalateLeadBodySchema = escalate.body;
export const escalateLeadInputSchema = escalate.input;

// ── create_followup_task / complete_task ────────────────────────────────────

const followup = build("leadId", { text: text(500), dueAt });
export const createFollowupBodySchema = followup.body;
export const createFollowupInputSchema = followup.input;

const complete = build("taskId", { done: z.boolean().default(true).describe("true completes the task, false reopens it.") });
export const completeTaskBodySchema = complete.body;
export const completeTaskInputSchema = complete.input;

// ── log_activity ────────────────────────────────────────────────────────────

const activity = build("leadId", {
  activityTypeId: id(),
  subject: text(200),
  notes: text(2000).optional(),
  durationMins: z.number().int().min(0).max(1440).optional(),
  outcome: text(500).optional(),
});
export const logActivityBodySchema = activity.body;
export const logActivityInputSchema = activity.input;

// ── ad leads ────────────────────────────────────────────────────────────────

const adStage = build("adLeadId", { stage: text(100).describe("A Meta lead stage slug (an active one).") });
export const setAdLeadStageBodySchema = adStage.body;
export const setAdLeadStageInputSchema = adStage.input;

const adNote = build("adLeadId", { body: text(4000) });
export const addAdLeadNoteBodySchema = adNote.body;
export const addAdLeadNoteInputSchema = adNote.input;

const adMove = build("adLeadId", {});
export const moveAdLeadBodySchema = adMove.body;
export const moveAdLeadInputSchema = adMove.input;

// ── requests that wait for a human ──────────────────────────────────────────

export const requestMergeBodySchema = z
  .strictObject({
    primaryLeadId: id().describe("The lead that should survive."),
    duplicateLeadIds: z.array(id()).min(1).max(5).describe("The leads that duplicate it."),
    reason: text(500),
  })
  .superRefine((o, ctx) => {
    const all = [o.primaryLeadId, ...o.duplicateLeadIds];
    if (new Set(all).size !== all.length) {
      ctx.addIssue({ code: "custom", message: "primaryLeadId and duplicateLeadIds must all be different leads." });
    }
  });
export const requestMergeInputSchema = requestMergeBodySchema;

const markWon = build("leadId", {
  value: z.number().positive().max(999_999_999).describe("Final deal value in Indian rupees."),
  expectedStartAt: z.string().datetime({ offset: true }).nullable().optional(),
  note: text(1000).optional(),
});
export const requestMarkWonBodySchema = markWon.body;
export const requestMarkWonInputSchema = markWon.input;

// ── responses ───────────────────────────────────────────────────────────────

export const leadSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  designation: z.string().nullable(),
  companyName: z.string(),
  city: z.string().nullable(),
  accountId: z.string(),
  ownerUserId: z.string().nullable().describe("null = nobody owns this lead yet."),
  stage: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
  isLead: z.boolean().describe("In the CRM Leads list."),
  createdAt: z.string(),
});

export const createLeadResponseSchema = z.object({
  lead: leadSummarySchema,
  created: z.boolean(),
  deduplicated: z.boolean().describe("true when the same phone was created moments ago and that lead is returned."),
});

export const leadChangeResponseSchema = z.object({
  lead: leadSummarySchema,
  changed: z.boolean(),
  fieldsChanged: z.array(z.string()).optional(),
});

export const noteResponseSchema = z.object({
  note: z.object({ id: z.string(), title: z.string().nullable(), createdAt: z.string() }),
});

export const productInterestResponseSchema = z.object({ added: z.number().int() });

export const assignResponseSchema = z.object({ assigned: z.boolean(), lead: leadSummarySchema });

export const escalationResponseSchema = z.object({
  escalated: z.literal(true),
  deduplicated: z.boolean(),
  taskId: z.string(),
  assignedTo: z.object({ userId: z.string(), name: z.string() }),
  source: z.enum(["configured", "rep", "admin"]),
});

export const taskResponseSchema = z.object({
  task: z.object({
    id: z.string(),
    text: z.string(),
    dueAt: z.string().nullable(),
    done: z.boolean(),
    remindUserId: z.string().nullable().optional(),
  }),
});

export const activityResponseSchema = z.object({ activity: z.object({ id: z.string(), occurredAt: z.string() }) });

export const adLeadStageResponseSchema = z.object({ id: z.string(), stage: z.string() });

export const adLeadNoteResponseSchema = z.object({ note: z.object({ id: z.string(), createdAt: z.string() }) });

export const moveAdLeadResponseSchema = z.object({
  accountContactId: z.string().nullable(),
  alreadyLinked: z.boolean(),
  matchedExisting: z.boolean(),
});

export const requestRecordedResponseSchema = z.object({ recorded: z.literal(true) });

export const dealResponseSchema = z.object({ deal: z.object({ id: z.string(), code: z.string() }) });
