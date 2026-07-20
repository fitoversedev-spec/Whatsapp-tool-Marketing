import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import ActivitiesClient from "./ActivitiesClient";

export default async function ActivitiesPage() {
  const user = await requireUser();
  const where = isAdmin(user.role) ? {} : { ownerUserId: user.id };

  const activities = await prisma.activity.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: 200,
    include: {
      activityType: { select: { name: true } },
      owner: { select: { id: true, name: true } },
      deal: { select: { id: true, code: true, title: true } },
      account: { select: { id: true, name: true } },
    },
  });

  return (
    <ActivitiesClient
      isAdmin={isAdmin(user.role)}
      activities={activities.map((a) => ({
        id: a.id,
        typeName: a.activityType.name,
        subject: a.subject,
        notes: a.notes,
        occurredAt: a.occurredAt.toISOString(),
        durationMins: a.durationMins,
        outcome: a.outcome,
        ownerName: a.owner.name,
        dealId: a.deal?.id ?? null,
        dealCode: a.deal?.code ?? null,
        accountId: a.account?.id ?? null,
        accountName: a.account?.name ?? null,
      }))}
    />
  );
}
