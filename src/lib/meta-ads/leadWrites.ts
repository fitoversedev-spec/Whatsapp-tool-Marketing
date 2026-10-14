// Writes on a captured Meta ad lead that the ad-campaign routes and the AI Sales
// Agent API both perform: validating a stage, adding a note, and "Move to CRM".
// [metaLeadId] is MetaLead.id (not the raw Meta leadgen id).
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { findAccountContactDuplicate } from "@/lib/crm/accounts";
import { firstLeadStage } from "@/lib/crm/leadStages";

// A stage the lead can be moved to: known, active and not removed.
export function findActiveMetaLeadStage(slug: string) {
  return prisma.metaLeadStage.findFirst({
    where: { slug, deletedAt: null, isActive: true },
    select: { slug: true },
  });
}

export function createMetaLeadNote(args: { metaLeadId: string; authorUserId: string; body: string }) {
  return prisma.metaLeadNote.create({
    data: { metaLeadId: args.metaLeadId, authorUserId: args.authorUserId, body: args.body },
    select: {
      id: true,
      body: true,
      createdAt: true,
      authorUserId: true,
      author: { select: { name: true } },
    },
  });
}

export type MoveToCrmResult =
  | { kind: "not_found" }
  | { kind: "invalid_owner" }
  // Promoted already (or a concurrent request just did it).
  | { kind: "already_linked"; accountContactId: string | null }
  | { kind: "ok"; accountContactId: string; leadSourceId: string | null; matchedExisting: boolean };

// "Move to CRM" for a Meta Instant-Form lead — promotes a raw MetaLead into the
// live CRM. Mirrors the Inbox conversation flow but starts from a MetaLead:
//   1. Already linked (MetaLead.accountContactId set) -> just return it.
//   2. An AccountContact already exists for this phone -> link to it.
//   3. Otherwise -> create Account + AccountContact(pipelineStage=LEAD) and link.
// ownerUserId is the rep to own the created Account; null leaves it UNASSIGNED.
// Nothing here creates a Deal — that's a later action from the CRM Contact page.
export async function moveMetaLeadToCrm(args: {
  metaLeadId: string;
  actorUserId: string;
  ownerUserId: string | null;
}): Promise<MoveToCrmResult> {
  const metaLead = await prisma.metaLead.findUnique({
    where: { id: args.metaLeadId },
    select: {
      id: true,
      fullName: true,
      phone: true,
      email: true,
      city: true,
      normalizedPhone: true,
      accountContactId: true,
    },
  });
  if (!metaLead) return { kind: "not_found" };

  // Idempotent: if this lead was already promoted, just hand back the link.
  if (metaLead.accountContactId) return { kind: "already_linked", accountContactId: metaLead.accountContactId };

  // Verify a picked rep still exists (avoids an FK violation on a stale id).
  const ownerUserId = args.ownerUserId;
  if (ownerUserId) {
    const rep = await prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { id: true, deletedAt: true },
    });
    if (!rep || rep.deletedAt) return { kind: "invalid_owner" };
  }

  // Normalize the lead phone to the same E.164 key the CRM dedupes on. Phase A
  // already stamps normalizedPhone at ingest; prefer it, but re-normalize the
  // raw phone as a fallback so this route stands on its own.
  const phone = (metaLead.phone ? normalizePhone(metaLead.phone) : null) ?? metaLead.normalizedPhone ?? null;

  const displayName = metaLead.fullName?.trim() || phone || "Unknown lead";

  // Look up the generic "Meta Ads" LeadSource (seeded in scripts/seed-taxonomies.ts).
  // Note: neither Account nor AccountContact carries a leadSourceId column — that
  // field lives on Deal, and no Deal is created here — so we can't persist the
  // attribution onto the promoted contact. We surface it in the response so the
  // caller (and any later Deal-from-lead action) can attribute the source; falls
  // back to null when the seed hasn't run.
  const metaAdsSource = await prisma.leadSource.findFirst({
    where: { slug: "meta_ads", deletedAt: null },
    select: { id: true },
  });
  const leadSourceId = metaAdsSource?.id ?? null;
  // A new lead starts at the first sales stage (Lead Generation).
  const startStage = await firstLeadStage();

  // Reuse an existing CRM contact with the same phone rather than duplicating it.
  const dup = await findAccountContactDuplicate({ phone, name: displayName });

  let result: string;
  try {
    result = await prisma.$transaction(async (tx) => {
      let targetId: string;
      if (dup) {
        targetId = dup.id;
        // Promote a plain (un-staged) matched contact so it lands in the CRM
        // Leads list (which filters pipelineStage='LEAD'). If it already has a
        // pipeline stage, leave it — never demote a further-along contact.
        const existing = await tx.accountContact.findUnique({
          where: { id: dup.id },
          select: { pipelineStage: true, leadSourceId: true, leadStageId: true },
        });
        if (existing && !existing.pipelineStage) {
          await tx.accountContact.update({
            where: { id: dup.id },
            data: {
              pipelineStage: "LEAD",
              promotedToLeadAt: new Date(),
              ...(leadSourceId && !existing.leadSourceId ? { leadSourceId } : {}),
              ...(startStage && !existing.leadStageId ? { leadStageId: startStage.id } : {}),
            },
          });
        }
      } else {
        const account = await tx.account.create({
          data: {
            name: displayName,
            ownerUserId,
            city: metaLead.city,
          },
        });
        const contact = await tx.accountContact.create({
          data: {
            accountId: account.id,
            name: displayName,
            phone,
            email: metaLead.email ?? null,
            isPrimary: true,
            pipelineStage: "LEAD",
            promotedToLeadAt: new Date(),
            createdByUserId: args.actorUserId,
            ...(leadSourceId ? { leadSourceId } : {}),
            ...(startStage ? { leadStageId: startStage.id } : {}),
          },
        });
        targetId = contact.id;
      }

      // Conditional link — only if still unlinked. If a concurrent request won
      // the race, this affects 0 rows and we throw to roll back the just-created
      // Account/Contact (prevents duplicate CRM contacts for one lead).
      const linked = await tx.metaLead.updateMany({
        where: { id: metaLead.id, accountContactId: null },
        data: { accountContactId: targetId },
      });
      if (linked.count === 0) throw new Error("already_linked");
      return targetId;
    });
  } catch (e) {
    // A concurrent request already promoted this lead — return the winning link.
    if (e instanceof Error && e.message === "already_linked") {
      const fresh = await prisma.metaLead.findUnique({
        where: { id: metaLead.id },
        select: { accountContactId: true },
      });
      return { kind: "already_linked", accountContactId: fresh?.accountContactId ?? null };
    }
    throw e;
  }

  return { kind: "ok", accountContactId: result, leadSourceId, matchedExisting: !!dup };
}
