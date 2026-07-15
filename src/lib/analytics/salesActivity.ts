// The headline analytics requirement (spec §11.3.B): "how many quotations
// and proposals did each person send?" No separate Proposal model exists in
// this build (out of Phase 1-2 scope, not in the approved plan) — that
// column is omitted rather than faked with zeros.
//
// Counting rule, exact per spec: a quotation counts when status="sent" AND
// sentAt falls in the window. Revisions (same deal, multiple sent
// quotations) count separately in quotationsSentInclRevisions, but
// uniqueDealsQuoted also ships alongside it — conflating the two is exactly
// what the spec warns causes arguments.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";

export type SalesActivityRow = {
  ownerId: string;
  ownerName: string;
  leadsCreated: number;
  dealsCreated: number;
  siteVisits: number;
  samplesSent: number;
  quotationsSentInclRevisions: number;
  uniqueDealsQuoted: number;
  quotedValue: number;
  dealsWon: number;
  dealsClosed: number; // won + lost, denominator for winRate
  wonValue: number;
  winRate: number | null; // null if dealsClosed is 0
  avgCycleDays: number | null; // null if fewer than MIN_SAMPLE_SIZE closed deals
};

export async function salesActivity(filter: AnalyticsFilter): Promise<SalesActivityRow[]> {
  const { from, to } = filter;
  const ownerWhere = filter.ownerIds?.length ? { id: { in: filter.ownerIds } } : {};

  const [owners, leadGroups, dealGroups, siteVisitGroups, sampleGroups, sentQuotes, closedDeals] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null, isActive: true, ...ownerWhere },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.lead.groupBy({
      by: ["ownerUserId"],
      where: { createdAt: { gte: from, lte: to }, ownerUserId: { not: null } },
      _count: { _all: true },
    }),
    prisma.deal.groupBy({
      by: ["ownerUserId"],
      where: { createdAt: { gte: from, lte: to }, deletedAt: null, ownerUserId: { not: null } },
      _count: { _all: true },
    }),
    prisma.activity.groupBy({
      by: ["ownerUserId"],
      where: { occurredAt: { gte: from, lte: to }, activityType: { slug: "site_visit" } },
      _count: { _all: true },
    }),
    prisma.activity.groupBy({
      by: ["ownerUserId"],
      where: { occurredAt: { gte: from, lte: to }, activityType: { slug: "sample_dispatch" } },
      _count: { _all: true },
    }),
    // Fetched as rows (not groupBy) so uniqueDealsQuoted (distinct dealId
    // per owner) can be computed in JS — Prisma's groupBy can't express
    // "count distinct X" directly.
    prisma.quotation.findMany({
      where: { status: "sent", sentAt: { gte: from, lte: to } },
      select: { createdByUserId: true, dealId: true, grandTotal: true },
    }),
    prisma.deal.findMany({
      where: { outcome: { in: ["WON", "LOST"] }, closedAt: { gte: from, lte: to }, ownerUserId: { not: null } },
      select: { ownerUserId: true, outcome: true, wonValue: true, enquiryAt: true, closedAt: true },
    }),
  ]);

  const leadMap = new Map(leadGroups.map((g) => [g.ownerUserId, g._count._all]));
  const dealMap = new Map(dealGroups.map((g) => [g.ownerUserId, g._count._all]));
  const visitMap = new Map(siteVisitGroups.map((g) => [g.ownerUserId, g._count._all]));
  const sampleMap = new Map(sampleGroups.map((g) => [g.ownerUserId, g._count._all]));

  const quoteByOwner = new Map<string, { count: number; dealIds: Set<string>; value: number }>();
  for (const q of sentQuotes) {
    const entry = quoteByOwner.get(q.createdByUserId) ?? { count: 0, dealIds: new Set<string>(), value: 0 };
    entry.count += 1;
    if (q.dealId) entry.dealIds.add(q.dealId);
    entry.value += Number(q.grandTotal);
    quoteByOwner.set(q.createdByUserId, entry);
  }

  const closedByOwner = new Map<string, { won: number; closed: number; wonValue: number; cycleDaysSum: number; cycleN: number }>();
  for (const d of closedDeals) {
    if (!d.ownerUserId) continue;
    const entry = closedByOwner.get(d.ownerUserId) ?? { won: 0, closed: 0, wonValue: 0, cycleDaysSum: 0, cycleN: 0 };
    entry.closed += 1;
    if (d.outcome === "WON") {
      entry.won += 1;
      entry.wonValue += d.wonValue ? Number(d.wonValue) : 0;
    }
    if (d.closedAt) {
      entry.cycleDaysSum += (d.closedAt.getTime() - d.enquiryAt.getTime()) / 86_400_000;
      entry.cycleN += 1;
    }
    closedByOwner.set(d.ownerUserId, entry);
  }

  return owners.map((u) => {
    const quotes = quoteByOwner.get(u.id);
    const closed = closedByOwner.get(u.id);
    return {
      ownerId: u.id,
      ownerName: u.name,
      leadsCreated: leadMap.get(u.id) ?? 0,
      dealsCreated: dealMap.get(u.id) ?? 0,
      siteVisits: visitMap.get(u.id) ?? 0,
      samplesSent: sampleMap.get(u.id) ?? 0,
      quotationsSentInclRevisions: quotes?.count ?? 0,
      uniqueDealsQuoted: quotes?.dealIds.size ?? 0,
      quotedValue: quotes?.value ?? 0,
      dealsWon: closed?.won ?? 0,
      dealsClosed: closed?.closed ?? 0,
      wonValue: closed?.wonValue ?? 0,
      winRate: closed && closed.closed > 0 ? closed.won / closed.closed : null,
      avgCycleDays: closed && closed.cycleN >= MIN_SAMPLE_SIZE ? closed.cycleDaysSum / closed.cycleN : null,
    };
  });
}
