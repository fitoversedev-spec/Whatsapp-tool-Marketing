import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin, canSeeAllCustomers, customerAccess } from "@/lib/rbac";
import { getUnifiedTimeline } from "@/lib/crm/timeline";
import DealDetailClient from "./DealDetailClient";

export default async function DealDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  // The unified Activity+Reminder timeline only needs the deal id (== params.id,
  // known before any query), so it rides in this first parallel batch instead of
  // running as a separate serial wave later. On a 404 the wasted query is harmless.
  const [deal, activityTypes, offices, cityTiers, leadSources, customerProfiles, users, timeline] = await Promise.all([
    prisma.deal.findUnique({
      where: { id: params.id },
      include: {
        account: {
          include: {
            contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
            customerProfile: true,
            owner: { select: { id: true, name: true } },
          },
        },
        owner: { select: { id: true, name: true } },
        office: true,
        currentStage: true,
        leadSource: true,
        lossReason: true,
        siteCityTier: true,
        primaryContact: { select: { name: true, phone: true, deletedAt: true } },
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
    getUnifiedTimeline({ dealId: params.id }),
  ]);

  if (!deal || deal.deletedAt) notFound();
  // The rep who won it, or anyone who can see the customer now (e.g. the rep
  // the customer was reassigned to).
  const canViewCustomer = customerAccess(user, deal.account.ownerUserId).canView;
  if (!customerAccess(user, deal.ownerUserId).canView && !canViewCustomer) notFound();
  const primaryContact = deal.primaryContact && !deal.primaryContact.deletedAt ? deal.primaryContact : null;

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
            ...(canSeeAllCustomers(user.role) ? {} : { ownerUserId: user.id }),
          },
          select: { id: true },
        })
      ).map((d) => d.id)
    : [deal.id];

  // Quotes, designs and product interest live on the customer (contact) now,
  // so a confirmed deal shows its customer's documents — for viewers who can
  // see that customer — plus anything attached to the deals themselves.
  const contactId = canViewCustomer && primaryContact ? deal.primaryContactId : null;
  const [dealQuotations, dealCourtImages, dealLineItems, contactInterests] = await Promise.all([
    prisma.quotation.findMany({
      where: {
        OR: [
          { dealId: { in: contactDealIds } },
          ...(contactId ? [{ accountContactId: contactId }] : []),
          ...(contactId && primaryContact?.phone ? [{ contactPhone: primaryContact.phone }] : []),
        ],
      },
      select: { id: true, number: true, sport: true, grandTotal: true, status: true, sentAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.courtImage.findMany({
      where: { OR: [{ dealId: { in: contactDealIds } }, ...(contactId ? [{ accountContactId: contactId }] : [])] },
      select: { id: true, number: true, status: true, imageUrl: true, image2dUrl: true, sentAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.dealLineItem.findMany({ where: { dealId: { in: contactDealIds }, OR: [{ isEnquiryOnly: true }, { productId: { not: null } }] }, select: { label: true, product: { select: { name: true } } } }),
    contactId
      ? prisma.contactProductInterest.findMany({ where: { accountContactId: contactId }, select: { label: true, product: { select: { name: true } } } })
      : Promise.resolve([] as { label: string | null; product: { name: string } | null }[]),
  ]);

  return (
    <DealDetailClient
      isAdmin={isAdmin(user.role)}
      users={users}
      deal={{
        id: deal.id,
        code: deal.code,
        title: deal.title,
        accountId: deal.account.id,
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
        expectedStartAt: deal.expectedStartAt?.toISOString() ?? null,
        wonNote: deal.wonNote,
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
      canViewCustomer={canViewCustomer}
      activityTypes={activityTypes.map((t) => ({ id: t.id, name: t.name }))}
      timeline={timeline}
      customerName={primaryContact?.name ?? deal.account.name}
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
        new Set([...contactInterests, ...dealLineItems].map((li) => li.product?.name ?? li.label).filter((n): n is string => !!n)),
      )}
    />
  );
}
