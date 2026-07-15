import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import DealDetailClient from "./DealDetailClient";

export default async function DealDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const [deal, activityTypes] = await Promise.all([
    prisma.deal.findUnique({
      where: { id: params.id },
      include: {
        account: { include: { contacts: true, customerProfile: true } },
        owner: { select: { id: true, name: true } },
        currentStage: true,
        leadSource: true,
        lossReason: true,
        stageHistory: {
          orderBy: { changedAt: "desc" },
          include: { fromStage: { select: { name: true } }, toStage: { select: { name: true } }, changedBy: { select: { name: true } } },
        },
      },
    }),
    prisma.activityType.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  if (!deal || deal.deletedAt) notFound();
  if (!isAdmin(user.role) && deal.ownerUserId && deal.ownerUserId !== user.id) notFound();

  const activities = await prisma.activity.findMany({
    where: { dealId: deal.id },
    orderBy: { occurredAt: "desc" },
    include: { activityType: { select: { name: true } }, owner: { select: { name: true } } },
  });

  return (
    <DealDetailClient
      deal={{
        id: deal.id,
        code: deal.code,
        title: deal.title,
        accountName: deal.account.name,
        accountCity: deal.account.city,
        contacts: deal.account.contacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone, isPrimary: c.isPrimary })),
        ownerName: deal.owner?.name ?? null,
        stageName: deal.currentStage.name,
        stageColorHex: deal.currentStage.colorHex,
        leadSourceName: deal.leadSource?.name ?? null,
        estimatedValue: deal.estimatedValue ? Number(deal.estimatedValue) : null,
        wonValue: deal.wonValue ? Number(deal.wonValue) : null,
        outcome: deal.outcome,
        lossReasonName: deal.lossReason?.name ?? null,
        lossReasonNote: deal.lossReasonNote,
        siteCity: deal.siteCity,
        enquiryAt: deal.enquiryAt.toISOString(),
        siteVisitAt: deal.siteVisitAt?.toISOString() ?? null,
        firstQuotedAt: deal.firstQuotedAt?.toISOString() ?? null,
        closedAt: deal.closedAt?.toISOString() ?? null,
      }}
      stageHistory={deal.stageHistory.map((h) => ({
        id: h.id,
        fromStageName: h.fromStage?.name ?? null,
        toStageName: h.toStage.name,
        changedByName: h.changedBy?.name ?? "system",
        changedAt: h.changedAt.toISOString(),
        durationInFromStageSeconds: h.durationInFromStageSeconds,
      }))}
      activities={activities.map((a) => ({
        id: a.id,
        typeName: a.activityType.name,
        subject: a.subject,
        notes: a.notes,
        occurredAt: a.occurredAt.toISOString(),
        ownerName: a.owner.name,
      }))}
      activityTypes={activityTypes.map((t) => ({ id: t.id, name: t.name }))}
    />
  );
}
