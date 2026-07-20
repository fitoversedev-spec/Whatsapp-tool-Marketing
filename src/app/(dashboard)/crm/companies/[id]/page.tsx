import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import { getUnifiedTimeline } from "@/lib/crm/timeline";
import CompanyDetailClient from "./CompanyDetailClient";

export default async function CompanyDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const account = await prisma.account.findUnique({
    where: { id: params.id },
    include: {
      owner: { select: { id: true, name: true } },
      customerProfile: { select: { id: true, name: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" } ] },
      deals: {
        where: { deletedAt: null },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true, code: true, title: true, quotedValue: true, wonValue: true,
          currentStage: { select: { name: true, colorHex: true, stageType: true } },
        },
      },
    },
  });
  if (!account || account.deletedAt) notFound();
  if (!isAdmin(user.role) && account.ownerUserId && account.ownerUserId !== user.id) notFound();

  const dealIds = account.deals.map((d) => d.id);
  const activities = await prisma.activity.findMany({
    where: { OR: [{ accountId: account.id }, dealIds.length ? { dealId: { in: dealIds } } : { id: "none" }] },
    orderBy: { occurredAt: "desc" },
    take: 20,
    include: { activityType: { select: { name: true } }, owner: { select: { name: true } } },
  });

  const timeline = await getUnifiedTimeline({ accountId: account.id });

  const customerProfiles = await prisma.customerProfile.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  const users = isAdmin(user.role)
    ? await prisma.user.findMany({
        where: { deletedAt: null, isActive: true, approvalStatus: "approved" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  return (
    <CompanyDetailClient
      isAdmin={isAdmin(user.role)}
      account={{
        id: account.id,
        name: account.name,
        city: account.city,
        businessType: account.businessType,
        gstin: account.gstin,
        notes: account.notes,
        customerProfileId: account.customerProfileId,
        customerProfileName: account.customerProfile?.name ?? null,
        ownerUserId: account.ownerUserId,
        ownerName: account.owner?.name ?? null,
      }}
      contacts={account.contacts.map((c) => ({
        id: c.id, name: c.name, phone: c.phone, email: c.email, designation: c.designation, isPrimary: c.isPrimary,
      }))}
      deals={account.deals.map((d) => ({
        id: d.id, code: d.code, title: d.title,
        quotedValue: d.quotedValue ? Number(d.quotedValue) : null,
        wonValue: d.wonValue ? Number(d.wonValue) : null,
        stageName: d.currentStage.name, stageColorHex: d.currentStage.colorHex,
      }))}
      activities={activities.map((a) => ({
        id: a.id, subject: a.subject, notes: a.notes, occurredAt: a.occurredAt.toISOString(),
        typeName: a.activityType.name, ownerName: a.owner.name, dealId: a.dealId,
      }))}
      customerProfiles={customerProfiles.map((c) => ({ id: c.id, name: c.name }))}
      users={users}
      timeline={timeline}
    />
  );
}
