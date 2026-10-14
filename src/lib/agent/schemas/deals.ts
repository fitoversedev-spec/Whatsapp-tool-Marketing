import { z } from "zod/v4";

/**
 * Request and response shapes for the deal and campaign tools (stage 6).
 *
 * Tools that wait for a human (APPROVAL) have two request schemas:
 *   <tool>BodySchema   what the caller sends (published in the OpenAPI document)
 *   <tool>InputSchema  what withAgent validates and the approval stores: the body
 *                      plus the id from the URL, which the route copies into the
 *                      body first (see leads/pathIds.ts), so the approver sees
 *                      which deal or broadcast the request is about.
 * Every object is strict: an unknown key is a 400, never silently dropped.
 */

const id = () => z.string().uuid();
const text = (max: number, min = 1) => z.string().trim().min(min).max(max);

const hasAny = (o: Record<string, unknown>) => Object.values(o).some((v) => v !== undefined);

// ── deals ───────────────────────────────────────────────────────────────────

const executionShape = {
  status: z.enum(["IN_EXECUTION", "COMPLETED"]).describe("IN_EXECUTION: work has started on site. COMPLETED: delivered."),
  reason: text(300).optional().describe("Why it is changing; shown to the approver."),
};
export const setDealExecutionStatusBodySchema = z.strictObject(executionShape);
export const setDealExecutionStatusInputSchema = z.strictObject({ dealId: id(), ...executionShape });

const wonValueShape = {
  wonValue: z.number().positive().max(999_999_999).optional().describe("Final confirmed project value in INR."),
  expectedStartAt: z.string().datetime({ offset: true }).nullable().optional().describe("When work is expected to start (ISO 8601); null clears it."),
  wonNote: text(1000).nullable().optional().describe("The rep's short note on the confirmed project; null clears it."),
  reason: text(300).optional().describe("Why it is changing; shown to the approver."),
};
const NEED_ONE_FIELD = { message: "Send at least one of wonValue, expectedStartAt or wonNote." };
const wonFieldsOnly = (o: Record<string, unknown>) =>
  hasAny({ wonValue: o.wonValue, expectedStartAt: o.expectedStartAt, wonNote: o.wonNote });
export const updateDealWonValueBodySchema = z.strictObject(wonValueShape).refine(wonFieldsOnly, NEED_ONE_FIELD);
export const updateDealWonValueInputSchema = z.strictObject({ dealId: id(), ...wonValueShape }).refine(wonFieldsOnly, NEED_ONE_FIELD);

export const dealChangeResponseSchema = z.object({
  deal: z.object({
    id: z.string(),
    code: z.string(),
    executionStatus: z.string().nullable(),
    wonValueInr: z.number().nullable(),
    expectedStartAt: z.string().nullable(),
    wonNote: z.string().nullable(),
  }),
  changed: z.boolean().describe("False when the deal already had exactly these values."),
});

// ── campaigns (broadcasts) ──────────────────────────────────────────────────

export const MAX_DRAFT_CONTACTS = 200;

/** Keys are the {{n}} placeholder numbers; values name the contact field that fills them. */
const variableMappingSchema = z
  .record(z.string().regex(/^[1-9][0-9]?$/, "Keys are placeholder numbers: \"1\", \"2\", ..."), text(60))
  .refine((m) => Object.keys(m).length <= 20, { message: "At most 20 placeholders." });

const oneSource = (b: { contactIds?: unknown; groupId?: unknown }) => (b.contactIds ? 1 : 0) + (b.groupId ? 1 : 0) === 1;

export const draftBroadcastBodySchema = z
  .strictObject({
    name: text(120),
    templateId: id(),
    contactIds: z
      .array(id())
      .min(1)
      .max(MAX_DRAFT_CONTACTS)
      .optional()
      .describe("Saved marketing contacts to message (max 200). Provide this or groupId."),
    groupId: id().optional().describe("A broadcast group; its members are frozen into the draft. Provide this or contactIds."),
    variableMapping: variableMappingSchema
      .default({})
      .describe('Which contact field fills each {{n}} placeholder, e.g. {"1":"name"}. Use "name" for the contact\'s name. Every placeholder in the template needs one.'),
  })
  .refine(oneSource, { message: "Provide exactly one of contactIds or groupId." });

export const draftBroadcastResponseSchema = z.object({
  broadcast: z.object({ id: z.string(), status: z.literal("draft") }),
  eligibleRecipients: z.number().int().describe("Contacts that will actually be messaged: consent given and not opted out."),
  excluded: z.object({
    optedOut: z.number().int(),
    noCampaignConsent: z.number().int(),
    notFound: z.number().int(),
  }),
  limits: z.object({ maxRecipients: z.number().int(), maxPerDay: z.number().int(), usedToday: z.number().int() }),
  template: z.object({ id: z.string(), name: z.string(), category: z.string() }),
  nextStep: z.string(),
});

export const getBroadcastStatusResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string().describe("draft, scheduled, running, paused, completed or failed."),
  pauseRequested: z.boolean(),
  recipients: z.number().int().describe("Total once launched; the eligible count at draft time before that."),
  sent: z.number().int(),
  delivered: z.number().int(),
  read: z.number().int(),
  failed: z.number().int(),
  scheduledAt: z.string().nullable(),
  launchedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const pauseBroadcastBodySchema = z.strictObject({});
export const pauseBroadcastResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  outcome: z.enum(["pause_requested", "schedule_cancelled", "already_stopped"]),
});

const launchShape = { note: text(300).optional().describe("Why this should go out; shown to the approver.") };
export const launchBroadcastBodySchema = z.strictObject(launchShape);
export const launchBroadcastInputSchema = z.strictObject({ broadcastId: id(), ...launchShape });

const scheduleShape = {
  scheduledAt: z.string().datetime({ offset: true }).describe("ISO 8601; between 2 minutes and 90 days from now."),
  note: text(300).optional().describe("Why; shown to the approver."),
};
export const scheduleBroadcastBodySchema = z.strictObject(scheduleShape);
export const scheduleBroadcastInputSchema = z.strictObject({ broadcastId: id(), ...scheduleShape });

export const launchBroadcastResponseSchema = z.object({
  id: z.string(),
  status: z.literal("running"),
  recipients: z.number().int(),
});
export const scheduleBroadcastResponseSchema = z.object({
  id: z.string(),
  status: z.literal("scheduled"),
  scheduledAt: z.string(),
  recipients: z.number().int(),
});
