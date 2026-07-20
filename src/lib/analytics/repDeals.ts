// Every deal one rep is handling, for the admin drill-down page reached by
// clicking a name in CRM Analytics' Individual performance tab. A roster,
// not a date-windowed metric — every open-or-closed deal they own, not just
// ones touched in the currently-selected date range.
import { prisma } from "@/lib/prisma";

export type RepDealRow = {
  dealId: string;
  dealCode: string;
  customerName: string;
  stageName: string;
  stageColorHex: string | null;
  quotations: { id: string; number: string; status: string }[];
  courtImages: { id: string; number: string; imageUrl: string | null; status: string }[];
  interestedProducts: string[];
  latestNote: { subject: string; notes: string | null; occurredAt: string } | null;
  nextActivity: { message: string; dueAt: string } | null;
};

export async function getRepDeals(ownerId: string): Promise<RepDealRow[]> {
  const now = new Date();
  const deals = await prisma.deal.findMany({
    where: { ownerUserId: ownerId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    include: {
      account: { select: { name: true } },
      primaryContact: { select: { name: true } },
      currentStage: { select: { name: true, colorHex: true } },
      quotations: { select: { id: true, number: true, status: true }, orderBy: { createdAt: "desc" } },
      courtImages: { select: { id: true, number: true, imageUrl: true, status: true }, orderBy: { createdAt: "desc" } },
      lineItems: {
        where: { OR: [{ isEnquiryOnly: true }, { productId: { not: null } }] },
        select: { label: true, product: { select: { name: true } } },
      },
      activities: { orderBy: { occurredAt: "desc" }, take: 1, select: { subject: true, notes: true, occurredAt: true } },
      reminders: {
        where: { completedAt: null, dueAt: { gte: now } },
        orderBy: { dueAt: "asc" },
        take: 1,
        select: { message: true, dueAt: true },
      },
    },
  });

  return deals.map((d) => ({
    dealId: d.id,
    dealCode: d.code,
    customerName: d.primaryContact?.name ?? d.account.name,
    stageName: d.currentStage.name,
    stageColorHex: d.currentStage.colorHex,
    quotations: d.quotations,
    courtImages: d.courtImages,
    interestedProducts: Array.from(new Set(d.lineItems.map((li) => li.product?.name ?? li.label).filter((n): n is string => !!n))),
    latestNote: d.activities[0]
      ? { subject: d.activities[0].subject, notes: d.activities[0].notes, occurredAt: d.activities[0].occurredAt.toISOString() }
      : null,
    nextActivity: d.reminders[0] ? { message: d.reminders[0].message, dueAt: d.reminders[0].dueAt.toISOString() } : null,
  }));
}
