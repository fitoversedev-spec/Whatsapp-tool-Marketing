import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findOrCreateDealForConversation } from "@/lib/crm/deals";

const createSchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
  message: z.string().min(1).max(500),
  dueAt: z.string().datetime(),
  // ["whatsapp"] opts into real outbound dispatch via the cron sweep;
  // omitted/empty = in-app only (today's only behavior).
  channels: z.array(z.enum(["whatsapp", "in_app"])).optional(),
  // Columns already existed on Reminder but were never accepted here —
  // see docs/DECISIONS.md (Phase 4).
  location: z.string().max(300).optional(),
  meetingUrl: z.string().url().max(500).optional(),
});

const listFilterSchema = z.enum(["overdue", "today", "week", "later", "completed", "all"]);

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const filterParam = req.nextUrl.searchParams.get("filter") ?? "all";
  const filter = listFilterSchema.safeParse(filterParam).success
    ? (filterParam as z.infer<typeof listFilterSchema>)
    : "all";
  const conversationId = req.nextUrl.searchParams.get("conversationId");

  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const baseWhere: Record<string, unknown> = { ownerUserId: user.id };
  if (conversationId) baseWhere.conversationId = conversationId;

  if (filter === "overdue") {
    Object.assign(baseWhere, { completedAt: null, dueAt: { lt: now } });
  } else if (filter === "today") {
    Object.assign(baseWhere, { completedAt: null, dueAt: { gte: now, lte: endOfToday } });
  } else if (filter === "week") {
    Object.assign(baseWhere, { completedAt: null, dueAt: { gt: endOfToday, lte: weekFromNow } });
  } else if (filter === "later") {
    Object.assign(baseWhere, { completedAt: null, dueAt: { gt: weekFromNow } });
  } else if (filter === "completed") {
    Object.assign(baseWhere, { completedAt: { not: null } });
  }
  // "all" applies no extra filter — useful when scoped to a single conversation.

  const reminders = await prisma.reminder.findMany({
    where: baseWhere,
    orderBy: [
      { completedAt: { sort: "asc", nulls: "first" } },
      { dueAt: "asc" },
    ],
    include: {
      conversation: {
        select: { id: true, contactPhone: true, contactName: true },
      },
    },
    take: 200,
  });

  return NextResponse.json({
    reminders: reminders.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      contactPhone: r.conversation?.contactPhone ?? null,
      contactName: r.conversation?.contactName ?? null,
      message: r.message,
      dueAt: r.dueAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      notifiedAt: r.notifiedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  if (parsed.data.conversationId) {
    const convo = await prisma.conversation.findUnique({
      where: { id: parsed.data.conversationId },
      select: { id: true, assignedToUserId: true },
    });
    if (!convo) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
    if (
      user.role !== "admin" &&
      convo.assignedToUserId !== null &&
      convo.assignedToUserId !== user.id
    ) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // The Inbox reminder panel only ever sends conversationId, never dealId —
  // resolve one server-side (find-or-create by conversation, same as
  // quotations/court-images) so a reminder set the normal way still shows up
  // in Deal-based analytics, with zero change needed on the client. Purely
  // standalone reminders (no conversationId at all) stay unlinked — there's
  // nothing to resolve a deal from.
  let dealId = parsed.data.dealId ?? null;
  if (!dealId && parsed.data.conversationId) {
    const resolved = await findOrCreateDealForConversation({
      conversationId: parsed.data.conversationId,
      // Falls back to the conversation's own contactName when it has one
      // (the common case) — this literal only surfaces for a contact with
      // no name on file at all.
      accountName: "Unknown customer",
      dealTitle: parsed.data.message.slice(0, 120),
      ownerUserId: user.id,
    });
    dealId = resolved.id;
  }

  const reminder = await prisma.reminder.create({
    data: {
      conversationId: parsed.data.conversationId ?? null,
      dealId,
      ownerUserId: user.id,
      message: parsed.data.message,
      dueAt: new Date(parsed.data.dueAt),
      channels: parsed.data.channels ?? [],
      location: parsed.data.location ?? null,
      meetingUrl: parsed.data.meetingUrl ?? null,
    },
    include: {
      conversation: { select: { contactPhone: true, contactName: true } },
    },
  });

  return NextResponse.json({
    reminder: {
      id: reminder.id,
      conversationId: reminder.conversationId,
      contactPhone: reminder.conversation?.contactPhone ?? null,
      contactName: reminder.conversation?.contactName ?? null,
      message: reminder.message,
      dueAt: reminder.dueAt.toISOString(),
      completedAt: null,
      notifiedAt: null,
      createdAt: reminder.createdAt.toISOString(),
    },
  });
}
