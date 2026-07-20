import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import CrmTabs from "@/components/crm/CrmTabs";
import DealsClient from "./DealsClient";

export default async function DealsPage() {
  const user = await requireUser();

  const dealsWhere = isAdmin(user.role) ? {} : { ownerUserId: user.id };

  const [deals, stages, leadSources, customerProfiles, lossReasons, users, products] = await Promise.all([
    prisma.deal.findMany({
      where: { deletedAt: null, ...dealsWhere },
      orderBy: { updatedAt: "desc" },
      take: 300,
      include: {
        account: { select: { id: true, name: true, city: true } },
        currentStage: { select: { id: true, name: true, slug: true, stageType: true, colorHex: true } },
        owner: { select: { id: true, name: true } },
      },
    }),
    prisma.funnelStage.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.leadSource.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.customerProfile.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.lossReason.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({
      where: { deletedAt: null, isActive: true, approvalStatus: "approved" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { archived: false },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <CrmTabs isAdmin={isAdmin(user.role)} />
      <DealsClient
      currentUserId={user.id}
      isAdmin={isAdmin(user.role)}
      deals={deals.map((d) => ({
        id: d.id,
        code: d.code,
        title: d.title,
        accountName: d.account.name,
        accountCity: d.account.city,
        stageId: d.currentStageId,
        stageName: d.currentStage.name,
        stageType: d.currentStage.stageType,
        stageColorHex: d.currentStage.colorHex,
        ownerName: d.owner?.name ?? null,
        estimatedValue: d.estimatedValue ? Number(d.estimatedValue) : null,
        quotedValue: d.quotedValue ? Number(d.quotedValue) : null,
        wonValue: d.wonValue ? Number(d.wonValue) : null,
        outcome: d.outcome,
        dealChannel: d.dealChannel,
        siteCity: d.siteCity,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      }))}
      stages={stages.map((s) => ({ id: s.id, name: s.name, slug: s.slug, stageType: s.stageType, colorHex: s.colorHex, requiresLossReason: s.requiresLossReason }))}
      leadSources={leadSources.map((s) => ({ id: s.id, name: s.name }))}
      customerProfiles={customerProfiles.map((c) => ({ id: c.id, name: c.name }))}
      lossReasons={lossReasons.map((l) => ({ id: l.id, name: l.name }))}
      users={users}
      products={products}
      />
    </>
  );
}
