// Generalizes repDeals.ts's getRepDeals() beyond just ownerId into an
// arbitrary filter bag — the ONE drill-to-deals mechanism every analytics
// card links to via a query-string-driven page, instead of N bespoke
// drill-downs. repDeals.ts and its existing rep/[userId] caller are
// untouched; this is a new, separate function alongside it.
//
// Same exclusion as repDeals.ts: deals still sitting in the default
// "Enquiry Received" stage are dropped — this is a drill-down into deals
// someone has actually started working, not a raw roster.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { defaultFunnelStageId } from "@/lib/crm/deals";
import { resolveCity } from "./geography";
import type { RepDealRow } from "./repDeals";

export type DealsDrilldownFilter = {
  ownerIds?: string[];
  productId?: string;
  sportId?: string;
  // Filter by a product's display name/label (what the Products analytics groups
  // on — most line items have no productId, only a rate-sheet label). "none"/
  // absent = no filter. Used by the per-product rep-breakdown drill.
  productLabel?: string;
  city?: string;
  customerProfileId?: string;
  stageId?: string;
  // Lead source (platform) filter. "none" → deals with no lead source (the
  // "(unspecified)" bucket); any other value is a LeadSource id.
  leadSourceId?: string;
  outcome?: "WON" | "LOST" | "DROPPED" | null;
  from?: Date;
  to?: Date;
};

export async function getDealsDrilldown(filter: DealsDrilldownFilter): Promise<RepDealRow[]> {
  const now = new Date();
  const defaultStageId = await defaultFunnelStageId();

  const where: Prisma.DealWhereInput = {
    deletedAt: null,
    currentStageId: filter.stageId ? filter.stageId : { not: defaultStageId },
  };
  if (filter.ownerIds?.length) where.ownerUserId = { in: filter.ownerIds };
  if (filter.productId || filter.sportId) {
    where.lineItems = {
      some: {
        ...(filter.productId ? { productId: filter.productId } : {}),
        ...(filter.sportId ? { sportId: filter.sportId } : {}),
      },
    };
  } else if (filter.productLabel) {
    // Match the Products analytics grouping (product.name ?? label). An exact
    // match on that label naturally only hits the intended (flooring) product.
    where.lineItems = {
      some: { OR: [{ label: filter.productLabel }, { product: { name: filter.productLabel } }] },
    };
  }
  if (filter.leadSourceId !== undefined) {
    where.leadSourceId = filter.leadSourceId === "none" ? null : filter.leadSourceId;
  }
  if (filter.customerProfileId) where.account = { customerProfileId: filter.customerProfileId };
  if (filter.outcome !== undefined) where.outcome = filter.outcome;
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }

  const deals = await prisma.deal.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      account: { select: { name: true, city: true } },
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

  // City is matched post-query via resolveCity() rather than in the WHERE
  // clause, so this bucket lines up exactly with geography.ts's grouping —
  // including the "(unspecified)" fallback bucket and its trimming.
  const cityFiltered = filter.city ? deals.filter((d) => resolveCity(d) === filter.city) : deals;

  return cityFiltered.map((d) => ({
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
