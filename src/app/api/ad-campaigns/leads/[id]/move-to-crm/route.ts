// "Move to CRM" for a Meta Instant-Form lead — the ad-campaign Leads table's
// per-row action that promotes a raw MetaLead into the live CRM. Mirrors the
// Inbox conversation flow (src/app/api/conversations/[id]/move-to-crm) but
// starts from a MetaLead instead of a WhatsApp Conversation, and is open to all
// approved reps (ad-campaign data isn't rep-scoped, so any rep can work a lead
// into the CRM and pick its owner). One POST, no form beyond the picked rep:
//   1. Already linked (MetaLead.accountContactId set) -> just return it.
//   2. An AccountContact already exists for this phone -> link to it.
//   3. Otherwise -> create Account + AccountContact(pipelineStage=LEAD) and link.
// The link is the MetaLead.accountContactId column (added in Phase A); nothing
// here creates a Deal — that's a later action from the CRM Contact/Lead detail.
//
// [id] is the MetaLead.id (not the raw Meta leadgen id).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { findAccountContactDuplicate } from "@/lib/crm/accounts";

const bodySchema = z.object({
  // The rep to own the created Account. Optional — falls back to the user
  // performing the promotion if the caller doesn't pick one.
  ownerUserId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Open to all approved reps — reps work their own ad leads into the CRM.

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const metaLead = await prisma.metaLead.findUnique({
    where: { id: params.id },
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
  if (!metaLead) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Idempotent: if this lead was already promoted, just hand back the link.
  if (metaLead.accountContactId) {
    return NextResponse.json({ ok: true, alreadyLinked: true, accountContactId: metaLead.accountContactId });
  }

  // Resolve + verify the owning rep (avoids an FK violation on a stale id).
  const ownerUserId = parsed.data.ownerUserId ?? user.id;
  if (parsed.data.ownerUserId) {
    const rep = await prisma.user.findUnique({
      where: { id: parsed.data.ownerUserId },
      select: { id: true, deletedAt: true },
    });
    if (!rep || rep.deletedAt) return NextResponse.json({ error: "invalid_owner" }, { status: 400 });
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
          select: { pipelineStage: true },
        });
        if (existing && !existing.pipelineStage) {
          await tx.accountContact.update({
            where: { id: dup.id },
            data: { pipelineStage: "LEAD", promotedToLeadAt: new Date() },
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
            // Stamp as a promoted lead so it lands in the CRM Leads list immediately.
            pipelineStage: "LEAD",
            promotedToLeadAt: new Date(),
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
      return NextResponse.json({ ok: true, alreadyLinked: true, accountContactId: fresh?.accountContactId ?? null });
    }
    throw e;
  }

  return NextResponse.json({
    ok: true,
    accountContactId: result,
    leadSourceId,
    matchedExisting: !!dup,
    alreadyLinked: false,
  });
}
