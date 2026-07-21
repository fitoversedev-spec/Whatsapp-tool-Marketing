import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import CompaniesClient from "./CompaniesClient";

export default async function CompaniesPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const user = await requireUser();
  // Lead types is meant to answer "who are our customers, grouped by type"
  // — an account with no real person attached isn't a customer yet, just an
  // artifact of Deal.accountId being required. Most of the pre-CRM backfilled
  // accounts are exactly this (see docs/DECISIONS.md's Lead Segments entry).
  // Date filter is optional and off by default (unlike the analytics
  // screens) — this is a browse/list page, not a report; reps expect to
  // see everything until they narrow it down themselves.
  const dateRange = searchParams.from && searchParams.to ? { from: searchParams.from, to: searchParams.to } : null;
  const where = {
    ...(isAdmin(user.role) ? { deletedAt: null } : { deletedAt: null, ownerUserId: user.id }),
    contacts: { some: {} },
    ...(dateRange ? { createdAt: { gte: new Date(dateRange.from + "T00:00:00"), lte: new Date(dateRange.to + "T23:59:59") } } : {}),
  };

  const [accounts, customerProfiles] = await Promise.all([
    prisma.account.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 300,
      include: {
        owner: { select: { id: true, name: true } },
        customerProfile: { select: { id: true, name: true } },
        _count: { select: { deals: true, contacts: true } },
        // Segment-by-lead-source needs each account's own deals' sources —
        // an account can span more than one, so this stays a list, not a
        // single value.
        deals: { select: { leadSource: { select: { name: true } } } },
      },
    }),
    prisma.customerProfile.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <CompaniesClient
      isAdmin={isAdmin(user.role)}
      companies={accounts.map((a) => ({
        id: a.id,
        name: a.name,
        city: a.city,
        businessType: a.businessType,
        customerProfileName: a.customerProfile?.name ?? null,
        leadSourceNames: Array.from(new Set(a.deals.map((d) => d.leadSource?.name).filter((n): n is string => !!n))),
        ownerName: a.owner?.name ?? null,
        dealCount: a._count.deals,
        contactCount: a._count.contacts,
        updatedAt: a.updatedAt.toISOString(),
      }))}
      customerProfiles={customerProfiles.map((c) => ({ id: c.id, name: c.name }))}
      dateRange={dateRange}
    />
  );
}
