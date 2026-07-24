import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import { getUnifiedTimeline } from "@/lib/crm/timeline";
import DealDetailClient from "./DealDetailClient";

export default async function DealDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const [deal, activityTypes, offices, cityTiers, leadSources, customerProfiles, users] = await Promise.all([
    prisma.deal.findUnique({
      where: { id: params.id },
      include: {
        account: { include: { contacts: true, customerProfile: true, owner: { select: { id: true, name: true } } } },
        owner: { select: { id: true, name: true } },
        office: true,
        currentStage: true,
        leadSource: true,
        lossReason: true,
        siteCityTier: true,
        primaryContact: { select: { name: true } },
        stageHistory: {
          orderBy: { changedAt: "desc" },
          include: { fromStage: { select: { name: true } }, toStage: { select: { name: true } }, changedBy: { select: { name: true } } },
        },
      },
    }),
    prisma.activityType.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.office.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.cityTier.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    prisma.leadSource.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.customerProfile.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({
      where: { role: { in: ["admin", "sales"] }, isActive: true, deletedAt: null, approvalStatus: "approved" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!deal || deal.deletedAt) notFound();
  if (!isAdmin(user.role) && deal.ownerUserId && deal.ownerUserId !== user.id) notFound();

  // Show the primary contact's quotations / court designs / product interest
  // across that contact's deals (same set the contact detail page shows) — a
  // customer's documents should be visible from any of their deals, not only
  // the specific deal a given quote/design was created on. Owner-scoped: a
  // non-admin only aggregates their OWN deals for this contact, so they can't
  // see another rep's deal documents through a shared contact (an admin sees
  // all of the contact's deals).
  const contactDealIds = deal.primaryContactId
    ? (
        await prisma.deal.findMany({
          where: {
            primaryContactId: deal.primaryContactId,
            deletedAt: null,
            ...(isAdmin(user.role) ? {} : { ownerUserId: user.id }),
          },
          select: { id: true },
        })
      ).map((d) => d.id)
    : [deal.id];

  const [dealQuotations, dealCourtImages, dealLineItems] = await Promise.all([
    prisma.quotation.findMany({ where: { dealId: { in: contactDealIds } }, select: { id: true, number: true, sport: true, grandTotal: true, status: true, sentAt: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    prisma.courtImage.findMany({ where: { dealId: { in: contactDealIds } }, select: { id: true, number: true, status: true, imageUrl: true, image2dUrl: true, sentAt: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    prisma.dealLineItem.findMany({ where: { dealId: { in: contactDealIds }, OR: [{ isEnquiryOnly: true }, { productId: { not: null } }] }, select: { label: true, product: { select: { name: true } } } }),
  ]);

  // Unified Activity+Reminder feed — previously two separate, un-merged
  // sections (and Reminders weren't shown here at all until this phase).
  const timeline = await getUnifiedTimeline({ dealId: deal.id });

  return (
    <DealDetailClient
      isAdmin={isAdmin(user.role)}
      users={users}
      deal={{
        id: deal.id,
        code: deal.code,
        title: deal.title,
        accountName: deal.account.name,
        accountCity: deal.account.city,
        accountOwnerUserId: deal.account.ownerUserId,
        accountOwnerName: deal.account.owner?.name ?? null,
        contacts: deal.account.contacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone, isPrimary: c.isPrimary })),
        ownerUserId: deal.ownerUserId,
        ownerName: deal.owner?.name ?? null,
        stageName: deal.currentStage.name,
        stageColorHex: deal.currentStage.colorHex,
        leadSourceId: deal.leadSourceId,
        leadSourceName: deal.leadSource?.name ?? null,
        customerProfileId: deal.account.customerProfileId,
        customerProfileName: deal.account.customerProfile?.name ?? null,
        businessType: deal.account.businessType,
        estimatedValue: deal.estimatedValue ? Number(deal.estimatedValue) : null,
        wonValue: deal.wonValue ? Number(deal.wonValue) : null,
        outcome: deal.outcome,
        lossReasonName: deal.lossReason?.name ?? null,
        lossReasonNote: deal.lossReasonNote,
        siteCity: deal.siteCity,
        siteCityTierId: deal.siteCityTierId,
        siteCityTierName: deal.siteCityTier?.name ?? null,
        siteState: deal.siteState,
        siteAddress: deal.siteAddress,
        officeId: deal.officeId,
        officeName: deal.office?.name ?? null,
        primaryContactId: deal.primaryContactId,
        expectedCloseAt: deal.expectedCloseAt?.toISOString() ?? null,
        enquiryAt: deal.enquiryAt.toISOString(),
        siteVisitAt: deal.siteVisitAt?.toISOString() ?? null,
        firstQuotedAt: deal.firstQuotedAt?.toISOString() ?? null,
        closedAt: deal.closedAt?.toISOString() ?? null,
        executionStatus: deal.executionStatus,
        executionStartedAt: deal.executionStartedAt?.toISOString() ?? null,
        deliveryCompletedAt: deal.deliveryCompletedAt?.toISOString() ?? null,
      }}
      offices={offices.map((o) => ({ id: o.id, name: o.name }))}
      cityTiers={cityTiers.map((c) => ({ id: c.id, name: c.name }))}
      leadSources={leadSources.map((s) => ({ id: s.id, name: s.name }))}
      customerProfiles={customerProfiles.map((c) => ({ id: c.id, name: c.name }))}
      stageHistory={deal.stageHistory.map((h) => ({
        id: h.id,
        fromStageName: h.fromStage?.name ?? null,
        toStageName: h.toStage.name,
        changedByName: h.changedBy?.name ?? "system",
        changedAt: h.changedAt.toISOString(),
        durationInFromStageSeconds: h.durationInFromStageSeconds,
      }))}
      activityTypes={activityTypes.map((t) => ({ id: t.id, name: t.name }))}
      timeline={timeline}
      customerName={deal.primaryContact?.name ?? deal.account.name}
      quotations={dealQuotations.map((q) => ({
        id: q.id,
        number: q.number,
        sport: q.sport,
        grandTotal: Number(q.grandTotal),
        status: q.status,
        date: (q.sentAt ?? q.createdAt).toISOString(),
      }))}
      courtImages={dealCourtImages.map((c) => ({
        id: c.id,
        number: c.number,
        status: c.status,
        imageUrl: c.image2dUrl ?? c.imageUrl,
        date: (c.sentAt ?? c.createdAt).toISOString(),
      }))}
      productInterests={Array.from(
        new Set(dealLineItems.map((li) => li.product?.name ?? li.label).filter((n): n is string => !!n)),
      )}
    />
  );
}
