import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import LeadsClient from "./LeadsClient";

export default async function LeadsPage() {
  const user = await requireUser();

  // The lead list and the assignee dropdown source are independent, so fetch
  // them concurrently instead of in a serial waterfall.
  const [leads, users] = await Promise.all([
    // Sales team + admin see all leads (they follow up daily).
    prisma.botLead.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 500,
      include: {
        conversation: {
          select: { id: true, contactPhone: true, contactName: true },
        },
      },
    }),
    // Assignee dropdown source
    prisma.user.findMany({
      where: { deletedAt: null, isActive: true, approvalStatus: "approved" },
      select: { id: true, name: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <LeadsClient
      currentUserId={user.id}
      isAdmin={user.role === "admin"}
      leads={leads.map((l) => ({
        id: l.id,
        conversationId: l.conversationId,
        contactPhone: l.contactPhone,
        contactName: l.contactName,
        path: l.path,
        location: l.location,
        sizeFt: l.sizeFt ? Number(l.sizeFt) : null,
        sport: l.sport,
        maintenanceType: l.maintenanceType,
        productCategory: l.productCategory,
        preferredDateTime: l.preferredDateTime?.toISOString() ?? null,
        status: l.status,
        assignedToUserId: l.assignedToUserId,
        notes: l.notes,
        createdAt: l.createdAt.toISOString(),
      }))}
      users={users}
    />
  );
}
