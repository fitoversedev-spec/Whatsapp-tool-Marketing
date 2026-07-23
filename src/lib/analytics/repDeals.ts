// Every deal one rep is handling, for the admin drill-down page reached by
// clicking a name in CRM Analytics' Individual performance tab. Originally
// a pure roster (not date-windowed) — every open-or-closed deal they own,
// regardless of the selected range. Now optionally date-filtered by
// createdAt per explicit request; omitting the range keeps the original
// unfiltered roster behavior.
//
// Excludes deals still sitting in the default/first funnel stage ("Enquiry
// Received") — every bulk-imported or freshly-created deal starts there
// (see defaultFunnelStageId), so without this exclusion the roster is just
// "every contact this rep owns" rather than customers they've actually
// started working, which is what this drill-down is for per explicit
// request ("don't list all of them, show only who he's converted to deal").
import { prisma } from "@/lib/prisma";
import { defaultFunnelStageId } from "@/lib/crm/deals";

export type RepDealRow = {
  dealId: string;
  dealCode: string;
  // Owner identity travels with every row so the admin deals-drilldown can
  // group / compare two reps' deals side by side without a second query. For
  // the single-rep rep drilldown these are always the one rep being viewed.
  ownerId: string;
  ownerName: string;
  // Best available monetary value for a single deal: won > quoted > estimated,
  // the same fallback chain funnelSegments.ts / funnel.ts use.
  dealValue: number;
  customerName: string;
  stageName: string;
  stageColorHex: string | null;
  outcome: string | null;
  quotations: { id: string; number: string; status: string; sport: string }[];
  courtImages: { id: string; number: string; imageUrl: string | null; status: string }[];
  interestedProducts: string[];
  latestNote: { subject: string; notes: string | null; occurredAt: string } | null;
  nextActivity: { message: string; dueAt: string } | null;
};

export async function getRepDeals(ownerId: string, dateRange?: { from: Date; to: Date }): Promise<RepDealRow[]> {
  const now = new Date();
  const defaultStageId = await defaultFunnelStageId();
  const deals = await prisma.deal.findMany({
    where: {
      ownerUserId: ownerId,
      deletedAt: null,
      currentStageId: { not: defaultStageId },
      ...(dateRange ? { createdAt: { gte: dateRange.from, lte: dateRange.to } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      account: { select: { name: true } },
      primaryContact: { select: { name: true } },
      owner: { select: { name: true } },
      currentStage: { select: { name: true, colorHex: true } },
      quotations: { select: { id: true, number: true, status: true, sport: true }, orderBy: { createdAt: "desc" } },
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
    ownerId: d.ownerUserId ?? "",
    ownerName: d.owner?.name ?? "(unassigned)",
    dealValue: Number(d.wonValue ?? d.quotedValue ?? d.estimatedValue ?? 0),
    customerName: d.primaryContact?.name ?? d.account.name,
    stageName: d.currentStage.name,
    stageColorHex: d.currentStage.colorHex,
    outcome: d.outcome,
    quotations: d.quotations,
    courtImages: d.courtImages,
    interestedProducts: Array.from(new Set(d.lineItems.map((li) => li.product?.name ?? li.label).filter((n): n is string => !!n))),
    latestNote: d.activities[0]
      ? { subject: d.activities[0].subject, notes: d.activities[0].notes, occurredAt: d.activities[0].occurredAt.toISOString() }
      : null,
    nextActivity: d.reminders[0] ? { message: d.reminders[0].message, dueAt: d.reminders[0].dueAt.toISOString() } : null,
  }));
}
