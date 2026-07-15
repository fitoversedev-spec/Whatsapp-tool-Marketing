import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import LeadsClient from "./LeadsClient";

export default async function LeadsPage() {
  const user = await requireUser();

  // The lead list and the assignee dropdown source are independent, so fetch
  // them concurrently instead of in a serial waterfall.
  const [leads, users, generalLeads] = await Promise.all([
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
    // General CRM leads (Phase 1) — referral/walk-in/manual entry, separate
    // from the chatbot-only BotLead table above. Own tab in the UI rather
    // than merged into one table since the two shapes don't overlap cleanly.
    prisma.lead.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { leadSource: { select: { name: true } }, owner: { select: { name: true } } },
    }),
  ]);

  return (
    <LeadsClient
      currentUserId={user.id}
      isAdmin={user.role === "admin"}
      generalLeads={generalLeads.map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        email: l.email,
        city: l.city,
        status: l.status,
        sourceName: l.leadSource?.name ?? null,
        ownerName: l.owner?.name ?? null,
        createdAt: l.createdAt.toISOString(),
      }))}
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
