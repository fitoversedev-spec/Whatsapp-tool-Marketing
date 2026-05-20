import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendText, describeMetaError, isMetaConfigured } from "@/lib/whatsapp";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const convo = await prisma.conversation.findUnique({
    where: { id: params.id },
    include: { messages: { orderBy: { createdAt: "asc" }, include: { sentBy: { select: { name: true } } } } },
  });
  if (!convo) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Sales role check: must be assigned to me or null
  if (user.role !== "admin" && convo.assignedToUserId && convo.assignedToUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Reset unread count on open
  if (convo.unreadCount > 0) {
    await prisma.conversation.update({ where: { id: convo.id }, data: { unreadCount: 0 } });
  }

  const withinWindow =
    !!convo.lastInboundAt && Date.now() - convo.lastInboundAt.getTime() < WINDOW_MS;

  return NextResponse.json({
    withinWindow,
    messages: convo.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      type: m.type,
      body: m.body,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
      sentByName: m.sentBy?.name ?? null,
    })),
  });
}

const replySchema = z.object({ body: z.string().min(1).max(4096) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = replySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const convo = await prisma.conversation.findUnique({ where: { id: params.id } });
  if (!convo) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Role check
  if (user.role !== "admin" && convo.assignedToUserId && convo.assignedToUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 24-hour window check
  if (!convo.lastInboundAt || Date.now() - convo.lastInboundAt.getTime() >= WINDOW_MS) {
    return NextResponse.json(
      { error: "24-hour window has expired. Use a template instead." },
      { status: 422 }
    );
  }

  if (!isMetaConfigured()) {
    return NextResponse.json({ error: "Meta credentials not configured on server" }, { status: 500 });
  }

  let waMessageId = "";
  try {
    const r = await sendText({ to: convo.contactPhone, body: parsed.data.body });
    waMessageId = r.waMessageId;
  } catch (err) {
    const e = describeMetaError(err);
    return NextResponse.json({ error: `Send failed: ${e.message}`, code: e.code }, { status: 502 });
  }

  // Auto-assign on first reply
  const assignedPatch =
    !convo.assignedToUserId ? { assignedToUserId: user.id } : {};

  const message = await prisma.message.create({
    data: {
      conversationId: convo.id,
      direction: "outbound",
      type: "text",
      body: parsed.data.body,
      waMessageId,
      status: "sent",
      sentByUserId: user.id,
    },
  });

  await prisma.conversation.update({
    where: { id: convo.id },
    data: { lastOutboundAt: new Date(), ...assignedPatch },
  });

  return NextResponse.json({
    message: {
      id: message.id,
      direction: "outbound",
      type: "text",
      body: message.body,
      status: message.status,
      createdAt: message.createdAt.toISOString(),
      sentByName: user.name,
    },
  });
}
