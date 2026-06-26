// One-shot data fetch for the ContactDetailDrawer (used on Pipeline page).
// Aggregates everything the drawer renders: contact, conversation, tags,
// notes, quotations, reminders, and a flat recent-activity feed.
//
// Sized for "card click" latency — caps each subquery so a chatty contact
// with thousands of messages still loads in under 250ms.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseFields } from "@/lib/contacts";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const convo = await prisma.conversation.findUnique({
    where: { id: params.id },
    include: {
      assignedTo: { select: { id: true, name: true } },
      labels: { include: { label: true } },
    },
  });
  if (!convo) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Sales role check — matches inbox visibility rules
  if (
    user.role !== "admin" &&
    convo.assignedToUserId !== null &&
    convo.assignedToUserId !== user.id
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Run all subqueries in parallel — none depend on each other once we have
  // the conversation row.
  const [contact, notes, quotations, reminders, messages, stageHistory, broadcasts] =
    await Promise.all([
      prisma.contact.findUnique({
        where: { phone: convo.contactPhone },
        include: { tags: { include: { tag: true } } },
      }),
      prisma.conversationNote.findMany({
        where: { conversationId: convo.id },
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        take: 10,
        include: { author: { select: { name: true } } },
      }),
      prisma.quotation.findMany({
        where: { conversationId: convo.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { createdBy: { select: { name: true } } },
      }),
      prisma.reminder.findMany({
        where: {
          conversationId: convo.id,
          // Active OR completed within last 14 days for context
          OR: [
            { completedAt: null },
            { completedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
          ],
        },
        orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { dueAt: "asc" }],
        take: 15,
        include: { owner: { select: { name: true } } },
      }),
      prisma.message.findMany({
        where: { conversationId: convo.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          direction: true,
          type: true,
          body: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.pipelineStageHistory.findMany({
        where: { conversationId: convo.id },
        orderBy: { changedAt: "desc" },
        take: 5,
        include: { changedBy: { select: { name: true } } },
      }),
      prisma.broadcastRecipient.findMany({
        where: { phoneE164: convo.contactPhone },
        orderBy: { sentAt: "desc" },
        take: 10,
        include: {
          broadcast: { select: { id: true, name: true, template: { select: { name: true } } } },
        },
      }),
    ]);

  // Build a unified recent-activity feed (latest 15 events of mixed types)
  type ActivityEvent =
    | { kind: "message"; id: string; at: string; direction: string; preview: string; status: string }
    | { kind: "stage"; id: string; at: string; fromStage: string | null; toStage: string; changedBy: string }
    | { kind: "broadcast"; id: string; at: string; name: string; templateName: string; status: string };

  const activity: ActivityEvent[] = [
    ...messages.map((m) => ({
      kind: "message" as const,
      id: m.id,
      at: m.createdAt.toISOString(),
      direction: m.direction,
      preview: (m.body ?? `(${m.type})`).slice(0, 140),
      status: m.status,
    })),
    ...stageHistory.map((s) => ({
      kind: "stage" as const,
      id: s.id,
      at: s.changedAt.toISOString(),
      fromStage: s.fromStage,
      toStage: s.toStage,
      changedBy: s.changedBy.name,
    })),
    ...broadcasts.map((b) => ({
      kind: "broadcast" as const,
      id: b.id,
      at: (b.sentAt ?? b.deliveredAt ?? new Date()).toISOString(),
      name: b.broadcast.name,
      templateName: b.broadcast.template.name,
      status: b.status,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 15);

  // Days in stage — small calc client could do, but keeps drawer dumb.
  const daysInStage = convo.stageChangedAt
    ? Math.floor((Date.now() - convo.stageChangedAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return NextResponse.json({
    contact: contact
      ? {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          allowCampaign: contact.allowCampaign,
          fields: parseFields(contact.fields),
          tags: contact.tags.map((t) => ({
            id: t.tag.id,
            name: t.tag.name,
            color: t.tag.color,
          })),
          tagIds: contact.tags.map((t) => t.tag.id),
        }
      : {
          id: null,
          name: convo.contactName,
          phone: convo.contactPhone,
          allowCampaign: true,
          fields: {},
          tags: [],
          tagIds: [],
        },
    conversation: {
      id: convo.id,
      status: convo.status,
      pipelineStage: convo.pipelineStage,
      dealValue: convo.dealValue?.toString() ?? null,
      expectedCloseAt: convo.expectedCloseAt?.toISOString() ?? null,
      stageChangedAt: convo.stageChangedAt?.toISOString() ?? null,
      daysInStage,
      assignedTo: convo.assignedTo
        ? { id: convo.assignedTo.id, name: convo.assignedTo.name }
        : null,
      labels: convo.labels.map((l) => ({
        id: l.label.id,
        name: l.label.name,
        color: l.label.color,
      })),
    },
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      pinned: n.pinned,
      authorId: n.author.name,
      authorName: n.author.name,
      createdAt: n.createdAt.toISOString(),
      editedAt: n.editedAt?.toISOString() ?? null,
    })),
    quotations: quotations.map((q) => ({
      id: q.id,
      number: q.number,
      grandTotal: q.grandTotal.toString(),
      status: q.status,
      pdfUrl: q.pdfUrl,
      quoteDate: q.quoteDate.toISOString(),
      sentAt: q.sentAt?.toISOString() ?? null,
      createdByName: q.createdBy.name,
      createdAt: q.createdAt.toISOString(),
    })),
    reminders: reminders.map((r) => ({
      id: r.id,
      message: r.message,
      dueAt: r.dueAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      ownerName: r.owner.name,
    })),
    activity,
  });
}
