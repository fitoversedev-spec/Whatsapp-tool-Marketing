import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin, canSeeAllCustomers } from "@/lib/rbac";
import CrmTabs from "@/components/crm/CrmTabs";
import DealsClient from "./DealsClient";

// Confirmed projects only (deals are created when a lead is marked Won).
export default async function DealsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const user = await requireUser();
  const seesAll = canSeeAllCustomers(user.role);

  const dateRange = searchParams.from && searchParams.to ? { from: searchParams.from, to: searchParams.to } : null;
  const dealsWhere = {
    deletedAt: null,
    outcome: "WON",
    ...(seesAll ? {} : { ownerUserId: user.id }),
    // Filters on when the project was won.
    ...(dateRange ? { closedAt: { gte: new Date(dateRange.from + "T00:00:00"), lte: new Date(dateRange.to + "T23:59:59") } } : {}),
  };

  const [deals, users] = await Promise.all([
    prisma.deal.findMany({
      where: dealsWhere,
      orderBy: [{ closedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 300,
      include: {
        account: { select: { id: true, name: true, city: true } },
        primaryContact: { select: { id: true, name: true, deletedAt: true } },
        owner: { select: { id: true, name: true } },
      },
    }),
    seesAll
      ? prisma.user.findMany({
          where: { deletedAt: null, isActive: true, approvalStatus: "approved" },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  return (
    <>
      <CrmTabs isAdmin={isAdmin(user.role)} />
      <DealsClient
        isAdmin={isAdmin(user.role)}
        showOwnerFilter={seesAll}
        users={users}
        dateRange={dateRange}
        deals={deals.map((d) => {
          const contact = d.primaryContact && !d.primaryContact.deletedAt ? d.primaryContact : null;
          return {
            id: d.id,
            code: d.code,
            customerId: contact?.id ?? null,
            customerName: (contact?.name ?? d.account.name).trim(),
            accountId: d.account.id,
            accountName: d.account.name.trim(),
            accountCity: d.account.city,
            ownerId: d.owner?.id ?? null,
            ownerName: d.owner?.name?.trim() ?? null,
            value: d.wonValue != null ? Number(d.wonValue) : d.quotedValue != null ? Number(d.quotedValue) : null,
            wonAt: d.closedAt?.toISOString() ?? null,
            expectedStartAt: d.expectedStartAt?.toISOString() ?? null,
            note: d.wonNote,
            executionStatus: d.executionStatus,
          };
        })}
      />
    </>
  );
}
