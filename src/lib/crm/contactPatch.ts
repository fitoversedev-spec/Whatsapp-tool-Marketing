// Applying an edit to one contact (AccountContact + the few fields that live on
// its Company) — name, phone, email, notes, custom fields, sales stage, move
// into / out of Leads — and recording each change on the contact Timeline.
// Shared by PATCH /api/account-contacts/[id] and the AI Sales Agent API so both
// validate the stage, write the rows and log the history the same way.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseFields } from "@/lib/contacts";
import { describeChanges, logContactEvents, type ContactEventInput } from "./contactEvents";
import { firstLeadStage } from "./leadStages";

export const LEAD_ADDED_SUMMARY = "Moved to Leads";
export const LEAD_REMOVED_SUMMARY = "Removed from Leads";

// What a patch needs to know about the contact it is changing.
export const PATCH_CONTACT_INCLUDE = {
  account: { select: { id: true, name: true, city: true, ownerUserId: true, customerProfileId: true, businessType: true } },
  leadStage: { select: { name: true } },
} as const;

export type PatchableContact = Prisma.AccountContactGetPayload<{ include: typeof PATCH_CONTACT_INCLUDE }>;

export type ContactPatchInput = {
  name?: string;
  phone?: string | null;
  email?: string | null;
  designation?: string | null;
  notes?: string | null;
  // Replaces the whole custom-fields object (merging is the caller's job).
  fields?: Record<string, string>;
  isPrimary?: boolean;
  // These three live on the parent Account, not AccountContact.
  siteCity?: string | null;
  customerProfileId?: string | null;
  businessType?: "B2B" | "B2C" | "B2G" | null;
  leadSourceId?: string | null;
  // "Move to Leads" (set "LEAD") / "Remove from Leads" (null).
  pipelineStage?: "LEAD" | null;
  // The contact's sales stage. Independent of pipelineStage.
  leadStageId?: string | null;
};

export class ContactPatchError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export type ContactPatchOptions = {
  // Timeline title of the "details edited" entry.
  detailsSummary?: string;
  // Extra text on the entries for a stage change / move into or out of Leads.
  eventDetail?: string;
};

export async function applyContactPatch(args: {
  before: PatchableContact;
  input: ContactPatchInput;
  actorUserId: string;
  options?: ContactPatchOptions;
}) {
  const { before, input, actorUserId } = args;
  const contactId = before.id;

  let newStage: { id: string; name: string } | null | undefined;
  if (input.leadStageId !== undefined && input.leadStageId !== before.leadStageId) {
    if (input.leadStageId) {
      const stage = await prisma.leadStage.findUnique({ where: { id: input.leadStageId }, select: { id: true, name: true, isActive: true, deletedAt: true } });
      if (!stage || stage.deletedAt || !stage.isActive) throw new ContactPatchError("Stage not available", 422);
      newStage = { id: stage.id, name: stage.name };
    } else {
      newStage = null;
    }
  }
  const movingIntoLeads = input.pipelineStage === "LEAD" && before.pipelineStage !== "LEAD";
  const leavingLeads = input.pipelineStage === null && before.pipelineStage === "LEAD";
  // Someone moved into Leads without a stage of their own starts at the first one.
  if (movingIntoLeads && newStage === undefined && !before.leadStageId) {
    newStage = (await firstLeadStage()) ?? undefined;
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.email !== undefined) data.email = input.email;
  if (input.designation !== undefined) data.designation = input.designation;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.fields !== undefined) data.fields = JSON.stringify(input.fields);
  if (input.leadSourceId !== undefined) data.leadSourceId = input.leadSourceId;
  if (newStage !== undefined) data.leadStageId = newStage?.id ?? null;
  if (input.pipelineStage !== undefined) {
    data.pipelineStage = input.pipelineStage;
    // Stamp the FIRST promotion to LEAD for the analytics Leads window; guard
    // against overwriting an existing timestamp when the row is already a LEAD.
    if (input.pipelineStage === "LEAD" && !before.promotedToLeadAt) {
      data.promotedToLeadAt = new Date();
    }
  }

  const accountData: Record<string, unknown> = {};
  if (input.siteCity !== undefined) accountData.city = input.siteCity;
  if (input.customerProfileId !== undefined) accountData.customerProfileId = input.customerProfileId;
  if (input.businessType !== undefined) accountData.businessType = input.businessType;

  const updated = await prisma.$transaction(async (tx) => {
    // Was previously only handled in the `true` case, which silently no-opped
    // when unchecking "Primary" — `if (parsed.data.isPrimary)` skips `false`.
    if (input.isPrimary !== undefined) {
      if (input.isPrimary) {
        await tx.accountContact.updateMany({
          where: { accountId: before.accountId, id: { not: contactId } },
          data: { isPrimary: false },
        });
      }
      data.isPrimary = input.isPrimary;
    }
    if (Object.keys(accountData).length) {
      await tx.account.update({ where: { id: before.accountId }, data: accountData });
    }
    return tx.accountContact.update({ where: { id: contactId }, data });
  });

  await logContactEvents(
    await describePatch(contactId, actorUserId, before, input, { newStage, movingIntoLeads, leavingLeads }, args.options),
  );

  return updated;
}

// Timeline entries for one PATCH: a details edit (old → new per field), a
// stage change, and a move into / out of Leads — each its own entry.
async function describePatch(
  contactId: string,
  actorUserId: string,
  before: PatchableContact,
  input: ContactPatchInput,
  moves: { newStage: { id: string; name: string } | null | undefined; movingIntoLeads: boolean; leavingLeads: boolean },
  options?: ContactPatchOptions,
): Promise<ContactEventInput[]> {
  const nameOf = async (model: "leadSource" | "customerProfile", id: string | null | undefined) => {
    if (!id) return null;
    const row = model === "leadSource"
      ? await prisma.leadSource.findUnique({ where: { id }, select: { name: true } })
      : await prisma.customerProfile.findUnique({ where: { id }, select: { name: true } });
    return row?.name ?? null;
  };

  const pairs: [string, string | null | undefined, string | null | undefined][] = [];
  if (input.name !== undefined) pairs.push(["Name", before.name, input.name]);
  if (input.phone !== undefined) pairs.push(["Phone", before.phone, input.phone]);
  if (input.email !== undefined) pairs.push(["Email", before.email, input.email]);
  if (input.designation !== undefined) pairs.push(["Designation", before.designation, input.designation]);
  if (input.notes !== undefined) pairs.push(["What this lead wants", before.notes, input.notes]);
  if (input.siteCity !== undefined) pairs.push(["City", before.account.city, input.siteCity]);
  if (input.businessType !== undefined) pairs.push(["Business type", before.account.businessType, input.businessType]);
  if (input.isPrimary !== undefined) pairs.push(["Primary contact", before.isPrimary ? "Yes" : "No", input.isPrimary ? "Yes" : "No"]);
  if (input.leadSourceId !== undefined && input.leadSourceId !== before.leadSourceId) {
    pairs.push(["Lead source", await nameOf("leadSource", before.leadSourceId), await nameOf("leadSource", input.leadSourceId)]);
  }
  if (input.customerProfileId !== undefined && input.customerProfileId !== before.account.customerProfileId) {
    pairs.push(["Customer segment", await nameOf("customerProfile", before.account.customerProfileId), await nameOf("customerProfile", input.customerProfileId)]);
  }
  if (input.fields !== undefined) {
    const oldFields = parseFields(before.fields);
    for (const key of Array.from(new Set([...Object.keys(oldFields), ...Object.keys(input.fields)]))) {
      pairs.push([key, oldFields[key], input.fields[key]]);
    }
  }

  const events: ContactEventInput[] = [];
  const lines = describeChanges(pairs);
  if (lines.length) {
    events.push({ contactId, actorUserId, kind: "details_edited", summary: options?.detailsSummary ?? "Details edited", detail: lines.join("\n") });
  }
  if (moves.movingIntoLeads) {
    events.push({ contactId, actorUserId, kind: "lead_added", summary: LEAD_ADDED_SUMMARY, detail: options?.eventDetail });
  }
  if (moves.leavingLeads) {
    events.push({ contactId, actorUserId, kind: "lead_removed", summary: LEAD_REMOVED_SUMMARY, detail: options?.eventDetail });
  }
  if (moves.newStage !== undefined) {
    events.push({
      contactId,
      actorUserId,
      kind: "stage_changed",
      summary: `Stage: ${before.leadStage?.name ?? "No stage"} → ${moves.newStage?.name ?? "No stage"}`,
      detail: options?.eventDetail,
    });
  }
  return events;
}
