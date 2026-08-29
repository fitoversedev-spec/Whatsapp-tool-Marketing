import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import LeadsClient from "./LeadsClient";

export default async function LeadsPage() {
  const user = await requireUser();

  // Same owner-scoping the Contacts list uses — ownership lives on the parent
  // Account, so sales sees only leads under accounts they own; admin sees all.
  const leads = await prisma.accountContact.findMany({
    where: {
      deletedAt: null,
      pipelineStage: "LEAD",
      ...(isAdmin(user.role) ? {} : { account: { ownerUserId: user.id } }),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: {
      account: { select: { id: true, name: true, ownerUserId: true } },
      // "Converted" is derived, never stored — a lead is converted once it
      // already backs a Deal as the primary contact.
      dealsAsPrimary: { where: { deletedAt: null }, select: { id: true }, take: 1 },
    },
  });

  return (
    <LeadsClient
      leads={leads.map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        accountId: l.account.id,
        accountName: l.account.name,
        converted: l.dealsAsPrimary.length > 0,
      }))}
    />
  );
}
