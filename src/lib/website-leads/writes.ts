// Writes on a website lead, shared by the /api/website-leads routes (and any
// later AI-agent tool). Business rules live in the helpers they reuse:
// stages come from the same MetaLeadStage list as ad leads, "Move to CRM" and
// "Move to marketing" run the same code as ad leads (src/lib/meta-ads/leadWrites.ts),
// and groups use src/lib/broadcast-groups.ts.
// [id] is WebsiteLead.id (not the website's own lead id).
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { copyLeadLabelsToContact } from "@/lib/crm/contactLabels";
import {
  findActiveMetaLeadStage,
  promoteLeadToCrm,
  upsertMarketingContact,
  type MoveToCrmResult,
} from "@/lib/meta-ads/leadWrites";

export { addWebsiteLeadsToGroup } from "@/lib/broadcast-groups";

const live = { deletedAt: null } as const;

// ---- stage -----------------------------------------------------------------

export type StageResult = "ok" | "not_found" | "invalid_stage";

export async function setWebsiteLeadStage(id: string, stage: string): Promise<StageResult> {
  const r = await updateWebsiteLead(id, { stage });
  return r === "invalid_assignee" ? "not_found" : r;
}

// ---- assignment ------------------------------------------------------------

// A rep a lead may be assigned to: active, approved, not deleted (the picker's list).
export function findAssignableRep(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true, approvalStatus: "approved" },
    select: { id: true, name: true },
  });
}

export type AssignResult = "ok" | "not_found" | "invalid_assignee";

/** Assign one lead to a rep; null takes the rep off. */
export async function assignWebsiteLead(id: string, repUserId: string | null): Promise<AssignResult> {
  const r = await updateWebsiteLead(id, { assignedToUserId: repUserId });
  return r === "invalid_stage" ? "not_found" : r;
}

export type UpdateResult = "ok" | "not_found" | "invalid_stage" | "invalid_assignee";

/** Change a lead's stage and/or rep in one write, checking both first so a bad one changes nothing. */
export async function updateWebsiteLead(
  id: string,
  patch: { stage?: string; assignedToUserId?: string | null },
): Promise<UpdateResult> {
  // Same rule as ad leads: a known, active stage of the shared lead pipeline.
  if (patch.stage !== undefined && !(await findActiveMetaLeadStage(patch.stage))) return "invalid_stage";
  if (patch.assignedToUserId && !(await findAssignableRep(patch.assignedToUserId))) return "invalid_assignee";
  const data: { stage?: string; assignedToUserId?: string | null } = {};
  if (patch.stage !== undefined) data.stage = patch.stage;
  if (patch.assignedToUserId !== undefined) data.assignedToUserId = patch.assignedToUserId;
  if (Object.keys(data).length === 0) return "ok";
  const res = await prisma.websiteLead.updateMany({ where: { id, ...live }, data });
  return res.count > 0 ? "ok" : "not_found";
}

/** Assign many leads to one rep at once; null takes the rep off. */
export async function assignWebsiteLeads(
  ids: string[],
  repUserId: string | null,
): Promise<{ kind: "ok"; updated: number; assignedToName: string | null } | { kind: "invalid_assignee" }> {
  let assignedToName: string | null = null;
  if (repUserId) {
    const rep = await findAssignableRep(repUserId);
    if (!rep) return { kind: "invalid_assignee" };
    assignedToName = rep.name;
  }
  const res = await prisma.websiteLead.updateMany({
    where: { id: { in: ids }, ...live },
    data: { assignedToUserId: repUserId },
  });
  return { kind: "ok", updated: res.count, assignedToName };
}

// ---- notes -----------------------------------------------------------------

/** Add a rep's note; null when the lead doesn't exist. */
export async function addWebsiteLeadNote(args: { websiteLeadId: string; authorUserId: string; body: string }) {
  const lead = await prisma.websiteLead.findFirst({ where: { id: args.websiteLeadId, ...live }, select: { id: true } });
  if (!lead) return null;
  return prisma.websiteLeadNote.create({
    data: { websiteLeadId: args.websiteLeadId, authorUserId: args.authorUserId, body: args.body },
    select: { id: true, body: true, createdAt: true, authorUserId: true, author: { select: { name: true } } },
  });
}

// ---- labels ----------------------------------------------------------------

export type LabelsResult = { kind: "ok"; labels: { id: string; name: string; color: string }[] } | { kind: "not_found" } | { kind: "invalid_label" };

/** Replace the lead's applied labels with `labelIds` (from the shared MetaLeadLabel catalogue). */
export async function setWebsiteLeadLabels(id: string, labelIds: string[]): Promise<LabelsResult> {
  const lead = await prisma.websiteLead.findFirst({ where: { id, ...live }, select: { id: true } });
  if (!lead) return { kind: "not_found" };
  const wanted = [...new Set(labelIds)];
  const found = wanted.length
    ? await prisma.metaLeadLabel.findMany({
        where: { id: { in: wanted } },
        select: { id: true, name: true, color: true },
      })
    : [];
  if (found.length !== wanted.length) return { kind: "invalid_label" };

  await prisma.$transaction(async (tx) => {
    await tx.websiteLeadToLabel.deleteMany({
      where: { websiteLeadId: id, labelId: { notIn: wanted.length ? wanted : ["__none__"] } },
    });
    if (wanted.length > 0) {
      await tx.websiteLeadToLabel.createMany({
        data: wanted.map((labelId) => ({ websiteLeadId: id, labelId })),
        skipDuplicates: true,
      });
    }
  });
  return { kind: "ok", labels: found };
}

// ---- Move to CRM -----------------------------------------------------------

/**
 * Link the lead to the CRM contact for its phone (creating Account + contact as a
 * LEAD when there is none), attributed to the "website" lead source. Idempotent.
 */
export async function moveWebsiteLeadToCrm(args: {
  websiteLeadId: string;
  actorUserId: string;
  ownerUserId: string | null;
}): Promise<MoveToCrmResult> {
  const lead = await prisma.websiteLead.findFirst({
    where: { id: args.websiteLeadId, ...live },
    select: { id: true, name: true, phone: true, normalizedPhone: true, email: true, city: true, accountContactId: true },
  });
  if (!lead) return { kind: "not_found" };
  // Moved before: labels were copied on that first move only (one-time copy).
  if (lead.accountContactId) return { kind: "already_linked", accountContactId: lead.accountContactId };

  return promoteLeadToCrm({
    lead: { name: lead.name, phone: lead.phone, normalizedPhone: lead.normalizedPhone, email: lead.email, city: lead.city },
    actorUserId: args.actorUserId,
    ownerUserId: args.ownerUserId,
    leadSourceSlug: "website",
    linkLead: async (tx, accountContactId) => {
      const linked = await tx.websiteLead.updateMany({
        where: { id: lead.id, accountContactId: null },
        data: { accountContactId },
      });
      return linked.count > 0;
    },
    copyLabels: (tx, accountContactId) => copyLeadLabelsToContact(tx, { websiteLeadId: lead.id }, accountContactId),
    readLink: async () => {
      const fresh = await prisma.websiteLead.findUnique({ where: { id: lead.id }, select: { accountContactId: true } });
      return fresh?.accountContactId ?? null;
    },
  });
}

// ---- Move to WhatsApp marketing --------------------------------------------

export type MoveToMarketingResult =
  | { kind: "ok"; created: boolean; contactId: string }
  | { kind: "not_found" }
  | { kind: "no_phone" };

/** Create (or reuse) the WhatsApp marketing contact for the lead's phone and remember it on the lead. */
export async function moveWebsiteLeadToMarketing(id: string): Promise<MoveToMarketingResult> {
  const lead = await prisma.websiteLead.findFirst({
    where: { id, ...live },
    select: { id: true, name: true, phone: true, normalizedPhone: true, city: true },
  });
  if (!lead) return { kind: "not_found" };

  const phone = (lead.phone ? normalizePhone(lead.phone) : null) ?? lead.normalizedPhone ?? null;
  if (!phone) return { kind: "no_phone" };

  const { created, contactId } = await upsertMarketingContact({ phone, name: lead.name.trim() || null, city: lead.city });
  await prisma.websiteLead.update({ where: { id: lead.id }, data: { contactId } });
  return { kind: "ok", created, contactId };
}
