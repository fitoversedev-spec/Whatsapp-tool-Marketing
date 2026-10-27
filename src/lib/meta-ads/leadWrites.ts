// Writes on a captured Meta ad lead that the ad-campaign routes and the AI Sales
// Agent API both perform: validating a stage, adding a note, and "Move to CRM".
// [metaLeadId] is MetaLead.id (not the raw Meta leadgen id). The CRM / marketing
// halves (promoteLeadToCrm, upsertMarketingContact) are shared with website leads.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { findAccountContactDuplicate } from "@/lib/crm/accounts";
import { copyLeadLabelsToContact } from "@/lib/crm/contactLabels";
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

// The part of "Move to CRM" every kind of captured lead shares (Meta ad leads,
// website leads): find or create the CRM contact for the lead's phone, then link
// the lead to it.
//   - An AccountContact already exists for this phone -> link to it.
//   - Otherwise -> create Account + AccountContact(pipelineStage=LEAD) and link.
// `linkLead` does the conditional "only if still unlinked" update on the lead's
// own table and returns false when a concurrent request won the race, which
// rolls back the just-created Account/Contact (prevents duplicate CRM contacts
// for one lead). `readLink` then returns the winning link.
// ownerUserId is the rep to own the created Account; null leaves it UNASSIGNED.
// `copyLabels` runs in the same transaction once the link is made, whether the
// contact was just created or already existed (see copyLeadLabelsToContact).
// Nothing here creates a Deal — that's a later action from the CRM Contact page.
export async function promoteLeadToCrm(args: {
  lead: {
    name: string | null;
    phone: string | null;
    normalizedPhone: string | null;
    email: string | null;
    city: string | null;
  };
  actorUserId: string;
  ownerUserId: string | null;
  leadSourceSlug: string;
  linkLead: (tx: Prisma.TransactionClient, accountContactId: string) => Promise<boolean>;
  copyLabels?: (tx: Prisma.TransactionClient, accountContactId: string) => Promise<void>;
  readLink: () => Promise<string | null>;
}): Promise<MoveToCrmResult> {
  const { lead } = args;

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
  const phone = (lead.phone ? normalizePhone(lead.phone) : null) ?? lead.normalizedPhone ?? null;

  const displayName = lead.name?.trim() || phone || "Unknown lead";

  // Look up the generic LeadSource ("meta_ads", "website"; seeded in
  // scripts/seed-taxonomies.ts and the website_leads migration).
  // Note: neither Account nor AccountContact carries a leadSourceId column — that
  // field lives on Deal, and no Deal is created here — so we can't persist the
  // attribution onto the promoted contact. We surface it in the response so the
  // caller (and any later Deal-from-lead action) can attribute the source; falls
  // back to null when the seed hasn't run.
  const source = await prisma.leadSource.findFirst({
    where: { slug: args.leadSourceSlug, deletedAt: null },
    select: { id: true },
  });
  const leadSourceId = source?.id ?? null;
  // A new lead starts at the first sales stage (Lead Generation).
  const startStage = await firstLeadStage();

  // Reuse an existing CRM contact with the same phone rather than duplicating it.
  const dup = await findAccountContactDuplicate({ phone, name: displayName });

  let result: string;
  try {
    // Prisma's default 5 s interactive-transaction limit is too tight for these round
    // trips (create + link + label copy) on a slow connection; same headroom as
    // mergeAccountContacts.
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
            city: lead.city,
          },
        });
        const contact = await tx.accountContact.create({
          data: {
            accountId: account.id,
            name: displayName,
            phone,
            email: lead.email ?? null,
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
      // the race this links nothing and we throw to roll back.
      if (!(await args.linkLead(tx, targetId))) throw new Error("already_linked");
      await args.copyLabels?.(tx, targetId);
      return targetId;
    }, { timeout: 20_000, maxWait: 10_000 });
  } catch (e) {
    // A concurrent request already promoted this lead — return the winning link.
    if (e instanceof Error && e.message === "already_linked") {
      return { kind: "already_linked", accountContactId: await args.readLink() };
    }
    throw e;
  }

  return { kind: "ok", accountContactId: result, leadSourceId, matchedExisting: !!dup };
}

// "Move to CRM" for a Meta Instant-Form lead — promotes a raw MetaLead into the
// live CRM. Mirrors the Inbox conversation flow but starts from a MetaLead:
//   1. Already linked (MetaLead.accountContactId set) -> just return it.
//   2. Otherwise link it to the CRM contact for its phone, creating one if
//      needed (promoteLeadToCrm).
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

  // Idempotent: if this lead was already promoted, just hand back the link. Labels
  // are copied only on the first move (a one-time copy, never re-synced).
  if (metaLead.accountContactId) return { kind: "already_linked", accountContactId: metaLead.accountContactId };

  return promoteLeadToCrm({
    lead: {
      name: metaLead.fullName,
      phone: metaLead.phone,
      normalizedPhone: metaLead.normalizedPhone,
      email: metaLead.email,
      city: metaLead.city,
    },
    actorUserId: args.actorUserId,
    ownerUserId: args.ownerUserId,
    leadSourceSlug: "meta_ads",
    linkLead: async (tx, accountContactId) => {
      const linked = await tx.metaLead.updateMany({
        where: { id: metaLead.id, accountContactId: null },
        data: { accountContactId },
      });
      return linked.count > 0;
    },
    copyLabels: (tx, accountContactId) => copyLeadLabelsToContact(tx, { metaLeadId: metaLead.id }, accountContactId),
    readLink: async () => {
      const fresh = await prisma.metaLead.findUnique({
        where: { id: metaLead.id },
        select: { accountContactId: true },
      });
      return fresh?.accountContactId ?? null;
    },
  });
}

// "Move to WhatsApp marketing" — upserts a lead's phone into the WhatsApp
// marketing Contact list (the same explicit, user-triggered, one-way sync as
// account-contacts/sync-to-marketing). Idempotent: an existing marketing contact
// is updated (name + the city merged into the "Attribute 1" field — the same key
// the imported contacts store city in, and only when it's still empty so a
// curated value is never clobbered), never duplicated, and its allowCampaign is
// NEVER touched, so a prior opt-out is preserved. New contacts default to
// allowCampaign:true, matching every other contact-creation path in this app.
export async function upsertMarketingContact(args: {
  phone: string; // E.164 key, already normalized
  name: string | null;
  city: string | null;
}): Promise<{ created: boolean; contactId: string }> {
  const { phone, name, city } = args;
  const existing = await prisma.contact.findUnique({ where: { phone } });
  if (existing) {
    // Merge the city into the existing fields (a JSON STRING) under the
    // "Attribute 1" key — the same key imported contacts use for city — and ONLY
    // when that key is still empty, so a value the user already curated is never
    // clobbered. Every other key is preserved. NEVER touch allowCampaign.
    let fields: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(existing.fields);
      if (parsed && typeof parsed === "object") fields = parsed as Record<string, unknown>;
    } catch {
      /* corrupt fields — start fresh */
    }
    const existingAttr1 = String(fields["Attribute 1"] ?? "").trim();
    if (city && !existingAttr1) fields["Attribute 1"] = city;
    await prisma.contact.update({
      where: { id: existing.id },
      // Only overwrite the name when we actually have one.
      data: { ...(name ? { name } : {}), fields: JSON.stringify(fields) },
    });
    return { created: false, contactId: existing.id };
  }

  const created = await prisma.contact.create({
    data: {
      phone,
      name,
      allowCampaign: true,
      fields: JSON.stringify(city ? { "Attribute 1": city } : {}),
    },
  });
  return { created: true, contactId: created.id };
}
