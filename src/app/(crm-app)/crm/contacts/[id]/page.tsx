import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageAllCustomers, customerAccess } from "@/lib/rbac";
import { parseFields } from "@/lib/contacts";
import { getContactTimeline } from "@/lib/crm/timeline";
import { listLeadStages } from "@/lib/crm/leadStages";
import ContactDetailClient from "./ContactDetailClient";

export default async function ContactDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const contact = await prisma.accountContact.findUnique({
    where: { id: params.id },
    include: {
      account: {
        select: {
          id: true, name: true, city: true, ownerUserId: true, customerProfileId: true, businessType: true,
          owner: { select: { name: true } },
        },
      },
      leadSource: {
        select: { id: true, name: true, colorHex: true },
      },
    },
  });
  if (!contact || contact.deletedAt) notFound();
  const access = customerAccess(user, contact.account.ownerUserId);
  if (!access.canView) notFound();
  // Admins and managers assign the rep, and can read every rep's private insight.
  const managesAll = canManageAllCustomers(user.role);

  // Wave A: everything that depends only on contact.id (already known). These
  // were previously 4 separate serial round-trips (timeline, the 7-query batch,
  // contactNotes, attachments); folded into one parallel batch.
  const leadSources = await prisma.leadSource.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, colorHex: true },
  });

  const [
    timeline,
    deals,
    activities,
    products,
    activityTypes,
    customerProfiles,
    contactNotes,
    attachments,
    leadStages,
    nextActions,
    insights,
    assignableUsers,
  ] = await Promise.all([
    getContactTimeline(contact.id, user),
    prisma.deal.findMany({
      where: { primaryContactId: contact.id, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, code: true, title: true, quotedValue: true, wonValue: true, estimatedValue: true,
        outcome: true, expectedStartAt: true, wonNote: true, executionStatus: true, closedAt: true,
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
    prisma.customerProfile.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.accountContactNote.findMany({
      where: { accountContactId: contact.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true } } },
    }),
    prisma.accountContactAttachment.findMany({
      where: { accountContactId: contact.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { uploadedBy: { select: { name: true } } },
    }),
    listLeadStages(),
    prisma.contactNextAction.findMany({
      where: { accountContactId: contact.id, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: { createdBy: { select: { name: true } }, doneBy: { select: { name: true } } },
    }),
    // Your own insights, plus — for admins/managers — every other rep's.
    prisma.contactInsight.findMany({
      where: { accountContactId: contact.id, deletedAt: null, ...(managesAll ? {} : { authorUserId: user.id }) },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true } } },
    }),
    managesAll
      ? prisma.user.findMany({
          where: { deletedAt: null, isActive: true, approvalStatus: "approved" },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  // Wave B: everything that depends on the contact's dealIds.
  // Quotations/court designs/product interest all hang off this contact's
  // deals (same as the Deals section above) — none of these 3 models link
  // to AccountContact directly. Deferred in Phase 1 pending exactly this.
  // Reminders either hang off a deal OR are anchored directly to the contact
  // (Zoho-style: task/meeting/call needs no deal); the OR still resolves
  // correctly when dealIds is empty. Next-action alerts are left out — they
  // show in the Next actions section instead of twice.
  const dealIds = deals.map((d) => d.id);
  const [quotations, courtImages, productInterests, reminders] = await Promise.all([
    // Linked to the contact directly; older ones through a deal or the phone.
    (() => {
      const or: object[] = [{ accountContactId: contact.id }];
      if (dealIds.length) or.push({ dealId: { in: dealIds } });
      if (contact.phone) or.push({ contactPhone: contact.phone });
      return prisma.quotation.findMany({
        where: { OR: or },
        orderBy: { createdAt: "desc" },
        select: { id: true, number: true, sport: true, grandTotal: true, status: true, contactPhone: true, sentAt: true, createdAt: true },
      });
    })(),
    prisma.courtImage.findMany({
      where: { OR: [{ accountContactId: contact.id }, ...(dealIds.length ? [{ dealId: { in: dealIds } }] : [])] },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, status: true, imageUrl: true, image2dUrl: true, contactPhone: true, sentAt: true, createdAt: true },
    }),
    prisma.contactProductInterest.findMany({
      where: { accountContactId: contact.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, label: true, createdAt: true,
        product: { select: { name: true } },
        sport: { select: { name: true } },
      },
    }),
    prisma.reminder.findMany({
      where: { OR: [{ dealId: { in: dealIds } }, { accountContactId: contact.id }], nextAction: { is: null } },
      orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { dueAt: "asc" }],
      include: { activityType: { select: { id: true, name: true } } },
    }),
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
        pipelineStage: contact.pipelineStage,
        leadStageId: contact.leadStageId,
        leadSourceId: contact.leadSourceId,
        leadSourceName: contact.leadSource?.name ?? null,
        leadSourceColor: contact.leadSource?.colorHex ?? null,
        accountId: contact.account.id,
        accountName: contact.account.name,
        accountCity: contact.account.city,
        accountCustomerProfileId: contact.account.customerProfileId,
        accountBusinessType: contact.account.businessType,
        ownerUserId: contact.account.ownerUserId,
        ownerName: contact.account.owner?.name ?? null,
        createdAt: contact.createdAt.toISOString(),
      }}
      viewer={{ id: user.id, canEdit: access.canEdit, managesAll }}
      leadStages={leadStages}
      assignableUsers={assignableUsers}
      leadSources={leadSources}
      deals={deals.map((d) => ({
        id: d.id, code: d.code, title: d.title,
        quotedValue: d.quotedValue ? Number(d.quotedValue) : null,
        wonValue: d.wonValue ? Number(d.wonValue) : null,
        estimatedValue: d.estimatedValue ? Number(d.estimatedValue) : null,
        stageName: d.currentStage.name, stageColorHex: d.currentStage.colorHex,
        outcome: d.outcome, expectedStartAt: d.expectedStartAt?.toISOString() ?? null, wonNote: d.wonNote,
        executionStatus: d.executionStatus, closedAt: d.closedAt?.toISOString() ?? null,
      }))}
      activities={activities.map((a) => ({
        id: a.id, subject: a.subject, notes: a.notes, occurredAt: a.occurredAt.toISOString(),
        typeName: a.activityType.name, ownerName: a.owner.name,
      }))}
      quotations={quotations.map((q) => ({
        id: q.id, number: q.number, sport: q.sport, grandTotal: Number(q.grandTotal), status: q.status,
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
      customerProfiles={customerProfiles}
      contactNotes={contactNotes.map((n) => ({
        id: n.id, title: n.title, body: n.body, createdAt: n.createdAt.toISOString(), authorName: n.author.name,
        authorUserId: n.authorUserId, editedAt: n.editedAt?.toISOString() ?? null,
      }))}
      reminders={reminders.map((r) => ({
        id: r.id, message: r.message, dueAt: r.dueAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null,
        completionNote: r.completionNote, location: r.location, meetingUrl: r.meetingUrl,
        priority: r.priority, activityTypeId: r.activityType?.id ?? null, activityTypeName: r.activityType?.name ?? null, notes: r.notes,
      }))}
      attachments={attachments.map((a) => ({
        id: a.id, fileName: a.fileName, fileUrl: a.fileUrl, fileSize: a.fileSize, mimeType: a.mimeType,
        createdAt: a.createdAt.toISOString(), uploadedByName: a.uploadedBy.name,
      }))}
      nextActions={nextActions.map((a) => ({
        id: a.id, text: a.text, dueAt: a.dueAt?.toISOString() ?? null, doneAt: a.doneAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(), createdByName: a.createdBy.name, doneByName: a.doneBy?.name ?? null,
      }))}
      insights={insights.map((i) => ({
        id: i.id, title: i.title, body: i.body, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString(),
        authorUserId: i.authorUserId, authorName: i.author.name,
      }))}
    />
  );
}
