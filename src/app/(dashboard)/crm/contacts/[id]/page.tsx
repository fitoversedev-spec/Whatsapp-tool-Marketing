import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import { parseFields } from "@/lib/contacts";
import { getUnifiedTimeline } from "@/lib/crm/timeline";
import ContactDetailClient from "./ContactDetailClient";

export default async function ContactDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const contact = await prisma.accountContact.findUnique({
    where: { id: params.id },
    include: { account: { select: { id: true, name: true, city: true, ownerUserId: true } } },
  });
  if (!contact) notFound();
  if (!isAdmin(user.role) && contact.account.ownerUserId && contact.account.ownerUserId !== user.id) notFound();

  const timeline = await getUnifiedTimeline({ accountContactId: contact.id });

  const [deals, activities, products, activityTypes, funnelStages, lossReasons] = await Promise.all([
    prisma.deal.findMany({
      where: { primaryContactId: contact.id, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, code: true, title: true, quotedValue: true, wonValue: true, estimatedValue: true,
        currentStageId: true,
        currentStage: { select: { name: true, colorHex: true } },
      },
    }),
    prisma.activity.findMany({
      where: { accountContactId: contact.id },
      orderBy: { occurredAt: "desc" },
      take: 20,
      include: { activityType: { select: { name: true } }, owner: { select: { name: true } } },
    }),
    prisma.product.findMany({ where: { archived: false }, select: { id: true, name: true, type: true }, orderBy: { name: "asc" } }),
    prisma.activityType.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.funnelStage.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, stageType: true, colorHex: true, requiresLossReason: true },
    }),
    prisma.lossReason.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <ContactDetailClient
      contact={{
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        designation: contact.designation,
        notes: contact.notes,
        fields: parseFields(contact.fields),
        isPrimary: contact.isPrimary,
        accountId: contact.account.id,
        accountName: contact.account.name,
        accountCity: contact.account.city,
        createdAt: contact.createdAt.toISOString(),
      }}
      deals={deals.map((d) => ({
        id: d.id, code: d.code, title: d.title,
        quotedValue: d.quotedValue ? Number(d.quotedValue) : null,
        wonValue: d.wonValue ? Number(d.wonValue) : null,
        estimatedValue: d.estimatedValue ? Number(d.estimatedValue) : null,
        stageId: d.currentStageId,
        stageName: d.currentStage.name, stageColorHex: d.currentStage.colorHex,
      }))}
      activities={activities.map((a) => ({
        id: a.id, subject: a.subject, notes: a.notes, occurredAt: a.occurredAt.toISOString(),
        typeName: a.activityType.name, ownerName: a.owner.name,
      }))}
      timeline={timeline}
      products={products}
      activityTypes={activityTypes}
      funnelStages={funnelStages}
      lossReasons={lossReasons}
    />
  );
}
