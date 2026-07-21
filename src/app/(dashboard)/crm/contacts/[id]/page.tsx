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
    include: {
      account: {
        select: { id: true, name: true, city: true, ownerUserId: true, customerProfileId: true, businessType: true },
      },
    },
  });
  if (!contact) notFound();
  if (!isAdmin(user.role) && contact.account.ownerUserId && contact.account.ownerUserId !== user.id) notFound();

  const timeline = await getUnifiedTimeline({ accountContactId: contact.id });

  const [deals, activities, products, activityTypes, funnelStages, lossReasons, customerProfiles] = await Promise.all([
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
    prisma.customerProfile.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);

  const contactNotes = await prisma.accountContactNote.findMany({
    where: { accountContactId: contact.id },
    orderBy: { createdAt: "desc" },
    include: { author: { select: { name: true } } },
  });

  // Quotations/court designs/product interest all hang off this contact's
  // deals (same as the Deals section above) — none of these 3 models link
  // to AccountContact directly. Deferred in Phase 1 pending exactly this.
  const dealIds = deals.map((d) => d.id);
  const [quotations, courtImages, productInterests] = await Promise.all([
    prisma.quotation.findMany({
      where: { dealId: { in: dealIds } },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, grandTotal: true, status: true, contactPhone: true, sentAt: true, createdAt: true },
    }),
    prisma.courtImage.findMany({
      where: { dealId: { in: dealIds } },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, status: true, imageUrl: true, image2dUrl: true, contactPhone: true, sentAt: true, createdAt: true },
    }),
    prisma.dealLineItem.findMany({
      where: { dealId: { in: dealIds }, isEnquiryOnly: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, label: true, createdAt: true,
        product: { select: { name: true } },
        sport: { select: { name: true } },
      },
    }),
  ]);

  const reminders = await prisma.reminder.findMany({
    where: { dealId: { in: dealIds } },
    orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { dueAt: "asc" }],
    include: { activityType: { select: { name: true } } },
  });

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
        accountCustomerProfileId: contact.account.customerProfileId,
        accountBusinessType: contact.account.businessType,
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
      quotations={quotations.map((q) => ({
        id: q.id, number: q.number, grandTotal: Number(q.grandTotal), status: q.status,
        contactPhone: q.contactPhone, sentAt: q.sentAt?.toISOString() ?? null, createdAt: q.createdAt.toISOString(),
      }))}
      courtImages={courtImages.map((c) => ({
        id: c.id, number: c.number, status: c.status, imageUrl: c.image2dUrl ?? c.imageUrl,
        contactPhone: c.contactPhone, sentAt: c.sentAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(),
      }))}
      productInterests={productInterests.map((p) => ({
        id: p.id, name: p.product?.name ?? p.label ?? "Unnamed product", sportName: p.sport?.name ?? null,
      }))}
      timeline={timeline}
      products={products}
      activityTypes={activityTypes}
      funnelStages={funnelStages}
      lossReasons={lossReasons}
      customerProfiles={customerProfiles}
      contactNotes={contactNotes.map((n) => ({
        id: n.id, title: n.title, body: n.body, createdAt: n.createdAt.toISOString(), authorName: n.author.name,
      }))}
      reminders={reminders.map((r) => ({
        id: r.id, message: r.message, dueAt: r.dueAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null,
        completionNote: r.completionNote, location: r.location, meetingUrl: r.meetingUrl,
        activityTypeName: r.activityType?.name ?? null,
      }))}
    />
  );
}
