import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyMetaSignature, isOptOutMessage } from "@/lib/webhook";
import { fetchInboundMedia } from "@/lib/whatsapp";
import { categorize, uploadToBlob } from "@/lib/media";
import { dispatchAutoReply } from "@/lib/auto-replies/dispatch";

// Meta requires GET for verification handshake
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "verify_failed" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  // Use arrayBuffer for byte-exact body capture — req.text() can normalize
  // newlines on some platforms, breaking HMAC signature verification.
  const rawBuf = Buffer.from(await req.arrayBuffer());
  const raw = rawBuf.toString("utf8");
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifyMetaSignature(raw, signature)) {
    // Log diagnostic info so we can see why Meta's real events fail HMAC
    // while curl tests pass. Logged but not exposed in response.
    console.error("[webhook] signature mismatch", {
      sigHeader: signature,
      bodyLen: rawBuf.length,
      bodyFirst200: raw.slice(0, 200),
      bodyLast50: raw.slice(-50),
      appSecretSet: !!process.env.META_APP_SECRET,
      appSecretLen: (process.env.META_APP_SECRET ?? "").length,
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Process every change in every entry
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const field = change.field ?? "";

      // Status updates (sent / delivered / read / failed)
      for (const status of value.statuses ?? []) {
        await handleStatusUpdate(status);
      }

      // Inbound messages
      for (const msg of value.messages ?? []) {
        const contact = (value.contacts ?? []).find((c: any) => c.wa_id === msg.from);
        await handleInboundMessage(msg, contact?.profile?.name);
      }

      // Template approval status callbacks
      if (field === "message_template_status_update") {
        await handleTemplateStatusUpdate(value);
      }
    }
  }

  return NextResponse.json({ ok: true });
}

async function handleStatusUpdate(status: any) {
  const waMessageId = status.id as string;
  const newStatus = status.status as "sent" | "delivered" | "read" | "failed";
  if (!waMessageId || !newStatus) return;

  const now = new Date();

  // Update message row if present
  await prisma.message
    .updateMany({
      where: { waMessageId },
      data: {
        status: newStatus,
        ...(status.errors?.[0] && {
          errorCode: String(status.errors[0].code ?? ""),
          errorMessage: status.errors[0].message ?? "",
        }),
      },
    })
    .catch(() => null);

  // Update broadcast_recipients if present
  const recipient = await prisma.broadcastRecipient.findUnique({ where: { waMessageId } }).catch(() => null);
  if (recipient) {
    const patch: any = { status: newStatus };
    if (newStatus === "sent") patch.sentAt = now;
    if (newStatus === "delivered") patch.deliveredAt = now;
    if (newStatus === "read") patch.readAt = now;
    if (newStatus === "failed" && status.errors?.[0]) {
      patch.errorCode = String(status.errors[0].code ?? "");
      patch.errorMessage = status.errors[0].message ?? "";
    }
    await prisma.broadcastRecipient.update({ where: { waMessageId }, data: patch });

    // Recompute broadcast counters
    const groups = await prisma.broadcastRecipient.groupBy({
      by: ["status"],
      where: { broadcastId: recipient.broadcastId },
      _count: { _all: true },
    });
    const counters: Record<string, number> = {};
    for (const g of groups) counters[g.status] = g._count._all;
    await prisma.broadcast.update({
      where: { id: recipient.broadcastId },
      data: {
        sent: counters.sent ?? 0,
        delivered: counters.delivered ?? 0,
        read: counters.read ?? 0,
        failed: counters.failed ?? 0,
      },
    });
  }
}

async function handleInboundMessage(msg: any, profileName?: string) {
  const from = msg.from as string;
  const waMessageId = msg.id as string;
  const type = msg.type as string;
  const body =
    type === "text"
      ? msg.text?.body
      : type === "button"
      ? msg.button?.text
      : (msg[type]?.caption ?? "");

  if (!from || !waMessageId) return;

  // Idempotency: skip if already stored
  const existing = await prisma.message.findUnique({ where: { waMessageId } }).catch(() => null);
  if (existing) return;

  // Upsert conversation
  const convo = await prisma.conversation.upsert({
    where: { contactPhone: from },
    create: {
      contactPhone: from,
      contactName: profileName ?? null,
      lastInboundAt: new Date(),
      unreadCount: 1,
    },
    update: {
      contactName: profileName ?? undefined,
      lastInboundAt: new Date(),
      unreadCount: { increment: 1 },
    },
  });

  // Media handling. For each media type Meta sends the media_id in the
  // type-named object (e.g. msg.image.id). We download bytes, push to
  // Vercel Blob, and persist the resulting URL + metadata so the inbox
  // can render the preview without round-tripping to Meta on every load.
  const mediaTypes = ["image", "video", "audio", "document", "sticker"] as const;
  let mediaFields: {
    mediaUrl?: string;
    mediaMimeType?: string;
    mediaFileName?: string;
    mediaSize?: number;
  } = {};
  let normalizedType = type;
  if (mediaTypes.includes(type as any)) {
    const mediaId = msg[type]?.id;
    const claimedFileName = msg[type]?.filename;
    if (mediaId) {
      try {
        const fetched = await fetchInboundMedia(mediaId);
        const uploaded = await uploadToBlob({
          bytes: fetched.bytes,
          fileName: claimedFileName ?? fetched.fileName,
          mimeType: fetched.mimeType,
          folder: "inbound",
        });
        mediaFields = {
          mediaUrl: uploaded.url,
          mediaMimeType: fetched.mimeType,
          mediaFileName: claimedFileName ?? fetched.fileName,
          mediaSize: fetched.bytes.length,
        };
      } catch (err) {
        console.error("[webhook] inbound media fetch failed", mediaId, err);
        // Don't drop the message — store it without media so the user at
        // least sees "received a file" with the caption.
      }
    }
    // Map sticker → image so the UI's image preview path handles it.
    if (type === "sticker") normalizedType = "image";
  }

  // Map normalizedType to one of our supported enum values.
  const storedType = (
    ["text", "image", "document", "video", "audio"].includes(normalizedType)
      ? normalizedType
      : "text"
  ) as "text" | "image" | "document" | "video" | "audio";

  await prisma.message.create({
    data: {
      conversationId: convo.id,
      direction: "inbound",
      type: storedType,
      body: body ?? null,
      waMessageId,
      status: "delivered",
      ...mediaFields,
    },
  });

  // Opt-out detection
  if (type === "text" && isOptOutMessage(body ?? "")) {
    await prisma.optOut.upsert({
      where: { phoneE164: from },
      create: { phoneE164: from, reason: "stop_reply" },
      update: { optedOutAt: new Date(), reason: "stop_reply" },
    });
    // Don't auto-reply on the same message that opts them out — that
    // would be perverse. Return early.
    return;
  }

  // Auto-reply dispatcher. Fires on plain text messages only (media
  // captions can be misleading). Dispatcher handles its own opt-out +
  // cooldown checks and silent-fails on any error so a bug here can't
  // break the webhook contract with Meta.
  if (type === "text" && body) {
    dispatchAutoReply({
      conversationId: convo.id,
      contactPhone: from,
      inboundBody: body,
    }).catch((err) => console.error("[webhook] auto-reply dispatch threw", err));
  }
}

async function handleTemplateStatusUpdate(value: any) {
  const metaTemplateId = value.message_template_id as string | undefined;
  const event = (value.event ?? "").toString().toLowerCase();
  if (!metaTemplateId) return;

  let status: "approved" | "rejected" | "paused" | "submitted" | null = null;
  if (event.includes("approved")) status = "approved";
  else if (event.includes("rejected")) status = "rejected";
  else if (event.includes("paused")) status = "paused";
  if (!status) return;

  await prisma.template
    .updateMany({
      where: { metaTemplateId },
      data: {
        status,
        rejectionReason: status === "rejected" ? value.reason ?? null : null,
      },
    })
    .catch(() => null);
}
