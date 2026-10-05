// Deals are confirmed projects only: one is created when a lead is marked
// Won (or from "+ New Deal"), already at the won stage, with the final value,
// the expected start date and the rep's note. The customer moves out of Leads.
// Shared by POST /api/account-contacts/[id]/won and the old-deal migration.
import { prisma } from "@/lib/prisma";
import { buildDealCode, nextDealSequenceForYear } from "./deals";
import { logContactEvent } from "./contactEvents";

export class ConfirmDealError extends Error {}

export async function wonFunnelStage() {
  return prisma.funnelStage.findFirst({
    where: { stageType: "won", isActive: true, deletedAt: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });
}

export async function confirmDeal(args: {
  contactId: string;
  value: number;
  expectedStartAt: Date | null;
  note: string | null;
  actorUserId: string;
}) {
  const contact = await prisma.accountContact.findUnique({
    where: { id: args.contactId },
    include: { account: { select: { id: true, city: true, ownerUserId: true } } },
  });
  if (!contact || contact.deletedAt) throw new ConfirmDealError("Contact not found");
  const wonStage = await wonFunnelStage();
  if (!wonStage) throw new ConfirmDealError("No active 'won' deal stage is set up (Admin → Taxonomies → Funnel Stages)");

  const firstQuote = await prisma.quotation.findFirst({
    where: { accountContactId: contact.id },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const now = new Date();
  const year = now.getFullYear();
  let seq = await nextDealSequenceForYear(year);

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const deal = await prisma.$transaction(async (tx) => {
        const d = await tx.deal.create({
          data: {
            code: buildDealCode(year, seq - 1),
            title: `Deal for ${contact.name.trim()}`,
            accountId: contact.accountId,
            primaryContactId: contact.id,
            ownerUserId: contact.account.ownerUserId ?? args.actorUserId,
            currentStageId: wonStage.id,
            outcome: "WON",
            wonValue: args.value,
            closedAt: now,
            expectedStartAt: args.expectedStartAt,
            wonNote: args.note,
            leadSourceId: contact.leadSourceId,
            siteCity: contact.account.city,
            dealChannel: "crm",
            // When this customer's enquiry started — keeps cycle-time
            // analytics meaningful for a deal created only at the win.
            enquiryAt: contact.promotedToLeadAt ?? contact.createdAt,
            firstQuotedAt: firstQuote?.createdAt ?? null,
          },
        });
        await tx.dealStageHistory.create({
          data: { dealId: d.id, fromStageId: null, toStageId: wonStage.id, changedByUserId: args.actorUserId, note: "Confirmed project" },
        });
        // Won customers move from Leads to Deals; their stage stays as history.
        await tx.accountContact.update({ where: { id: contact.id }, data: { pipelineStage: null } });
        return d;
      });
      if (contact.pipelineStage === "LEAD") {
        await logContactEvent({ contactId: contact.id, actorUserId: args.actorUserId, kind: "lead_removed", summary: `Won — moved from Leads to Deals (${deal.code})` });
      }
      return deal;
    } catch (err) {
      if ((err as { code?: string })?.code !== "P2002") throw err;
      seq += 1; // deal code taken by a concurrent create — try the next one
    }
  }
  throw new ConfirmDealError("Could not assign a unique deal code — try again in a moment");
}
