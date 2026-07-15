// Segment table (spec §11.3.E): rows = CustomerProfile, enquiries/win
// rate/avg deal size/repeat rate. Repeat buyer = an Account with >=2 WON
// deals (spec §4.5) — derived here, not stored.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";

export type SegmentRow = {
  profileName: string; // "(unclassified)" for accounts with no CustomerProfile set
  enquiries: number;
  won: number;
  winRate: number | null;
  avgDealSize: number | null;
  avgCycleDays: number | null; // null if fewer than MIN_SAMPLE_SIZE closed deals
};

export type BusinessTypeRow = { businessType: string; enquiries: number; won: number; wonValue: number };

export type RepeatCustomer = { accountId: string; accountName: string; wonDeals: number; totalWonValue: number };

export async function customerSegments(
  filter: AnalyticsFilter,
): Promise<{ segments: SegmentRow[]; businessTypes: BusinessTypeRow[]; repeatCustomers: RepeatCustomer[] }> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const deals = await prisma.deal.findMany({
    where: { deletedAt: null, createdAt: { gte: filter.from, lte: filter.to }, ...ownerWhere },
    select: {
      outcome: true,
      wonValue: true,
      account: { select: { id: true, name: true, businessType: true, customerProfile: { select: { name: true } } } },
    },
  });

  // Cycle time over deals that CLOSED in the window, same reasoning as
  // geography.ts / salesActivity.ts — creation-date and close-date cohorts
  // must not be conflated.
  const closedDeals = await prisma.deal.findMany({
    where: { deletedAt: null, outcome: { in: ["WON", "LOST"] }, closedAt: { gte: filter.from, lte: filter.to }, ...ownerWhere },
    select: { enquiryAt: true, closedAt: true, account: { select: { customerProfile: { select: { name: true } } } } },
  });
  const cycleMap = new Map<string, { sum: number; n: number }>();
  for (const d of closedDeals) {
    if (!d.closedAt) continue;
    const profile = d.account.customerProfile?.name ?? "(unclassified)";
    const entry = cycleMap.get(profile) ?? { sum: 0, n: 0 };
    entry.sum += (d.closedAt.getTime() - d.enquiryAt.getTime()) / 86_400_000;
    entry.n += 1;
    cycleMap.set(profile, entry);
  }

  const segMap = new Map<string, { enquiries: number; won: number; wonValue: number }>();
  const btMap = new Map<string, { enquiries: number; won: number; wonValue: number }>();
  for (const d of deals) {
    const profile = d.account.customerProfile?.name ?? "(unclassified)";
    const s = segMap.get(profile) ?? { enquiries: 0, won: 0, wonValue: 0 };
    s.enquiries += 1;
    if (d.outcome === "WON") {
      s.won += 1;
      s.wonValue += d.wonValue ? Number(d.wonValue) : 0;
    }
    segMap.set(profile, s);

    const bt = d.account.businessType ?? "(unclassified)";
    const b = btMap.get(bt) ?? { enquiries: 0, won: 0, wonValue: 0 };
    b.enquiries += 1;
    if (d.outcome === "WON") {
      b.won += 1;
      b.wonValue += d.wonValue ? Number(d.wonValue) : 0;
    }
    btMap.set(bt, b);
  }

  const segments: SegmentRow[] = [...segMap.entries()]
    .map(([profileName, v]) => {
      const cycle = cycleMap.get(profileName);
      return {
        profileName,
        enquiries: v.enquiries,
        won: v.won,
        winRate: v.enquiries > 0 ? v.won / v.enquiries : null,
        avgDealSize: v.won > 0 ? v.wonValue / v.won : null,
        avgCycleDays: cycle && cycle.n >= MIN_SAMPLE_SIZE ? cycle.sum / cycle.n : null,
      };
    })
    .sort((a, b) => b.enquiries - a.enquiries);

  const businessTypes: BusinessTypeRow[] = [...btMap.entries()]
    .map(([businessType, v]) => ({ businessType, ...v }))
    .sort((a, b) => b.enquiries - a.enquiries);

  // Repeat buyers — >=2 WON deals on the same account, all-time (not
  // filtered to the date range; "have they ever bought twice" is the point).
  const wonByAccount = await prisma.deal.groupBy({
    by: ["accountId"],
    where: { outcome: "WON", deletedAt: null },
    _count: { _all: true },
    _sum: { wonValue: true },
    having: { accountId: { _count: { gte: 2 } } },
  });
  const accountIds = wonByAccount.map((w) => w.accountId);
  const accounts = accountIds.length ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }) : [];
  const accountNameMap = new Map(accounts.map((a) => [a.id, a.name]));
  const repeatCustomers: RepeatCustomer[] = wonByAccount
    .map((w) => ({
      accountId: w.accountId,
      accountName: accountNameMap.get(w.accountId) ?? "(unknown)",
      wonDeals: w._count._all,
      totalWonValue: w._sum.wonValue ? Number(w._sum.wonValue) : 0,
    }))
    .sort((a, b) => b.wonDeals - a.wonDeals);

  return { segments, businessTypes, repeatCustomers };
}
