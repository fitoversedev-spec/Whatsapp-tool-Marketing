import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import { parseFields } from "@/lib/contacts";
import AccountContactsClient from "./AccountContactsClient";

export default async function AccountContactsPage({ searchParams }: { searchParams: { from?: string; to?: string; rep?: string } }) {
  const user = await requireUser();
  const dateRange = searchParams.from && searchParams.to ? { from: searchParams.from, to: searchParams.to } : null;
  // Admin-only — sales already only ever sees their own contacts (the
  // ownerUserId branch just below), so a rep filter is only meaningful for
  // admin's cross-team view. Answers "how many is this rep handling" via the
  // same {contacts.length} count the page already shows.
  const repFilter = isAdmin(user.role) ? searchParams.rep : undefined;
  const where = {
    deletedAt: null,
    ...(isAdmin(user.role) ? (repFilter ? { account: { ownerUserId: repFilter } } : {}) : { account: { ownerUserId: user.id } }),
    ...(dateRange ? { createdAt: { gte: new Date(dateRange.from + "T00:00:00"), lte: new Date(dateRange.to + "T23:59:59") } } : {}),
  };

  const [contacts, accounts, leadSources, customerProfiles, funnelStages, users] = await Promise.all([
    prisma.accountContact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { account: { select: { id: true, name: true, city: true, ownerUserId: true } } },
    }),
    prisma.account.findMany({
      where: isAdmin(user.role) ? { deletedAt: null } : { deletedAt: null, ownerUserId: user.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.leadSource.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.customerProfile.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.funnelStage.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, colorHex: true } }),
    // Only fetched for the reassign-owner picker, which is admin-only UI —
    // harmless to fetch either way given the pool size, but skip the point.
    isAdmin(user.role)
      ? prisma.user.findMany({
          where: { deletedAt: null, isActive: true, approvalStatus: "approved" },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return (
    <AccountContactsClient
      isAdmin={isAdmin(user.role)}
      contacts={contacts.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        designation: c.designation,
        fields: parseFields(c.fields),
        isPrimary: c.isPrimary,
        accountId: c.account.id,
        accountName: c.account.name,
        accountOwnerUserId: c.account.ownerUserId,
      }))}
      accounts={accounts}
      leadSources={leadSources}
      customerProfiles={customerProfiles}
      funnelStages={funnelStages}
      users={users}
      dateRange={dateRange}
      repFilter={repFilter ?? ""}
    />
  );
}
