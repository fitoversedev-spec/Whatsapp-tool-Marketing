import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseFields } from "@/lib/contacts";
import ContactTimelineClient from "./ContactTimelineClient";

export default async function ContactDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const contact = await prisma.contact.findUnique({
    where: { id: params.id },
    include: { tags: { include: { tag: true } } },
  });
  if (!contact) notFound();

  // Locate the conversation for this contact (one per phone)
  const conversation = await prisma.conversation.findUnique({
    where: { contactPhone: contact.phone },
    select: {
      id: true,
      pipelineStage: true,
      dealValue: true,
      assignedToUserId: true,
      assignedTo: { select: { id: true, name: true } },
    },
  });

  // Sales sees only their own / unassigned. If they pull up a contact whose
  // conversation is owned by someone else, bounce them. Admin sees all.
  if (
    user.role !== "admin" &&
    conversation &&
    conversation.assignedToUserId !== null &&
    conversation.assignedToUserId !== user.id
  ) {
    redirect("/contacts");
  }

  const convoId = conversation?.id ?? null;

  // Pull everything we'll merge into the feed. Parallel queries — none of
  // these depend on each other.
  const [messages, notes, reminders, stageHistory, broadcastsReceived] = convoId
    ? await Promise.all([
        prisma.message.findMany({
          where: { conversationId: convoId },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: {
            id: true,
            direction: true,
            type: true,
            body: true,
            mediaUrl: true,
            mediaMimeType: true,
            mediaFileName: true,
            status: true,
            createdAt: true,
          },
        }),
        prisma.conversationNote.findMany({
          where: { conversationId: convoId },
          orderBy: { createdAt: "desc" },
          include: { author: { select: { name: true } } },
        }),
        prisma.reminder.findMany({
          where: { conversationId: convoId },
          orderBy: { dueAt: "desc" },
          include: { owner: { select: { name: true } } },
        }),
        prisma.pipelineStageHistory.findMany({
          where: { conversationId: convoId },
          orderBy: { changedAt: "desc" },
          include: { changedBy: { select: { name: true } } },
        }),
        prisma.broadcastRecipient.findMany({
          where: { phoneE164: contact.phone },
          orderBy: { sentAt: "desc" },
          take: 50,
          include: {
            broadcast: { select: { id: true, name: true, template: { select: { name: true } } } },
          },
        }),
      ])
    : [[], [], [], [], []];

  return (
    <ContactTimelineClient
      contact={{
        id: contact.id,
        phone: contact.phone,
        name: contact.name,
        allowCampaign: contact.allowCampaign,
        fields: parseFields(contact.fields),
        createdAt: contact.createdAt.toISOString(),
        tagIds: contact.tags.map((ct) => ct.tag.id),
        tags: contact.tags.map((ct) => ({
          id: ct.tag.id,
          name: ct.tag.name,
          color: ct.tag.color,
        })),
      }}
      conversation={
        conversation
          ? {
              id: conversation.id,
              pipelineStage: conversation.pipelineStage,
              dealValue: conversation.dealValue?.toString() ?? null,
              assignedToName: conversation.assignedTo?.name ?? null,
            }
          : null
      }
      messages={messages.map((m) => ({
        id: m.id,
        kind: "message" as const,
        direction: m.direction,
        type: m.type,
        body: m.body,
        mediaUrl: m.mediaUrl,
        mediaMimeType: m.mediaMimeType,
        mediaFileName: m.mediaFileName,
        status: m.status,
        at: m.createdAt.toISOString(),
      }))}
      notes={notes.map((n) => ({
        id: n.id,
        kind: "note" as const,
        body: n.body,
        authorName: n.author.name,
        at: n.createdAt.toISOString(),
      }))}
      reminders={reminders.map((r) => ({
        id: r.id,
        kind: "reminder" as const,
        message: r.message,
        ownerName: r.owner.name,
        completedAt: r.completedAt?.toISOString() ?? null,
        dueAt: r.dueAt.toISOString(),
        at: r.dueAt.toISOString(),
      }))}
      stageHistory={stageHistory.map((s) => ({
        id: s.id,
        kind: "stage" as const,
        fromStage: s.fromStage,
        toStage: s.toStage,
        changedByName: s.changedBy.name,
        at: s.changedAt.toISOString(),
      }))}
      broadcastsReceived={broadcastsReceived.map((b) => ({
        id: b.id,
        kind: "broadcast" as const,
        broadcastName: b.broadcast.name,
        templateName: b.broadcast.template.name,
        status: b.status,
        at: (b.sentAt ?? b.deliveredAt ?? b.readAt ?? new Date()).toISOString(),
      }))}
    />
  );
}
