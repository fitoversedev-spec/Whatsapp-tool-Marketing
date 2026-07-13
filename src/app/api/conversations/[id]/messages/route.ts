import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendText, sendMedia, describeMetaError, isMetaConfigured } from "@/lib/whatsapp";
import { categorize } from "@/lib/media";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
  const beforeRaw = url.searchParams.get("before"); // ISO createdAt cursor for older pages
  const before = beforeRaw ? new Date(beforeRaw) : null;

  const convo = await prisma.conversation.findUnique({ where: { id: params.id } });
  if (!convo) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Sales role check: must be assigned to me or null
  if (user.role !== "admin" && convo.assignedToUserId && convo.assignedToUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Page the most-recent messages (uses the [conversationId, createdAt] index).
  // Loading the ENTIRE thread history on every 8s poll was a major scale/lag
  // problem for long threads — fetch one extra row to know if older exist.
  const rows = await prisma.message.findMany({
    where: {
      conversationId: convo.id,
      ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    include: { sentBy: { select: { name: true } } },
  });
  const hasMore = rows.length > limit;
  const page = (hasMore ? rows.slice(0, limit) : rows).reverse(); // oldest → newest

  // Reset unread only on the initial (latest) load, not when paging older.
  if (!before && convo.unreadCount > 0) {
    await prisma.conversation.update({ where: { id: convo.id }, data: { unreadCount: 0 } });
  }

  const withinWindow =
    !!convo.lastInboundAt && Date.now() - convo.lastInboundAt.getTime() < WINDOW_MS;

  return NextResponse.json({
    withinWindow,
    hasMore,
    messages: page.map((m) => ({
      id: m.id,
      direction: m.direction,
      type: m.type,
      body: m.body,
      mediaUrl: m.mediaUrl,
      mediaMimeType: m.mediaMimeType,
      mediaFileName: m.mediaFileName,
      mediaSize: m.mediaSize,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
      sentByName: m.sentBy?.name ?? null,
    })),
  });
}

// Accept either { body } for text, or { mediaId } + optional { caption } for media.
// mediaId references a Media row previously uploaded via /api/media/upload.
const replySchema = z.union([
  z.object({ body: z.string().min(1).max(4096) }),
  z.object({
    mediaId: z.string().uuid(),
    caption: z.string().max(1024).optional(),
  }),
]);

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

  if (!(await isMetaConfigured())) {
    return NextResponse.json({ error: "Meta credentials not configured on server" }, { status: 500 });
  }

  const data = parsed.data;
  let waMessageId = "";
  let createData: any;

  if ("mediaId" in data) {
    const media = await prisma.media.findUnique({ where: { id: data.mediaId } });
    if (!media) return NextResponse.json({ error: "Media not found" }, { status: 404 });
    const cat = categorize(media.mimeType);
    if (cat === "other") {
      return NextResponse.json(
        { error: `Cannot send file of type ${media.mimeType} via WhatsApp` },
        { status: 422 }
      );
    }
    try {
      const r = await sendMedia({
        to: convo.contactPhone,
        mediaType: cat,
        url: media.url,
        caption: data.caption,
        filename: cat === "document" ? media.fileName : undefined,
      });
      waMessageId = r.waMessageId;
    } catch (err) {
      const e = describeMetaError(err);
      return NextResponse.json({ error: `Send failed: ${e.message}`, code: e.code }, { status: 502 });
    }
    createData = {
      conversationId: convo.id,
      direction: "outbound",
      type: cat,
      body: data.caption ?? null,
      mediaUrl: media.url,
      mediaMimeType: media.mimeType,
      mediaFileName: media.fileName,
      mediaSize: media.size,
      waMessageId,
      status: "sent",
      sentByUserId: user.id,
    };
  } else {
    try {
      const r = await sendText({ to: convo.contactPhone, body: data.body });
      waMessageId = r.waMessageId;
    } catch (err) {
      const e = describeMetaError(err);
      return NextResponse.json({ error: `Send failed: ${e.message}`, code: e.code }, { status: 502 });
    }
    createData = {
      conversationId: convo.id,
      direction: "outbound",
      type: "text",
      body: data.body,
      waMessageId,
      status: "sent",
      sentByUserId: user.id,
    };
  }

  // Auto-assign on first reply
  const assignedPatch =
    !convo.assignedToUserId ? { assignedToUserId: user.id } : {};

  const message = await prisma.message.create({ data: createData });

  await prisma.conversation.update({
    where: { id: convo.id },
    data: { lastOutboundAt: new Date(), ...assignedPatch },
  });

  return NextResponse.json({
    message: {
      id: message.id,
      direction: "outbound",
      type: message.type,
      body: message.body,
      mediaUrl: message.mediaUrl,
      mediaMimeType: message.mediaMimeType,
      mediaFileName: message.mediaFileName,
      mediaSize: message.mediaSize,
      status: message.status,
      createdAt: message.createdAt.toISOString(),
      sentByName: user.name,
    },
  });
}
