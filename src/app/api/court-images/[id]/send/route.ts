// Send a court-image design to the customer via WhatsApp. Accepts a
// `formats` array — any combination of 2d / 3d-image / 3d-video. Each
// selected format becomes its own WhatsApp message (image or video) in
// the order 2d → 3d-image → 3d-video. The caption is attached to the
// first message only (WhatsApp client convention).
//
// Mirrors each sent media into the linked conversation (if any) so the
// thread shows the full series of attachments the customer received.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendMedia, sendText, describeMetaError } from "@/lib/whatsapp";
import { advanceDealStageIfEarlier } from "@/lib/funnel/transitionDeal";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  formats: z
    .array(z.enum(["2d", "3d-image", "3d-video"]))
    .min(1)
    .max(3)
    .optional(),
});

const FORMAT_ORDER: Array<"2d" | "3d-image" | "3d-video"> = [
  "2d",
  "3d-image",
  "3d-video",
];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const row = await prisma.courtImage.findUnique({
    where: { id: params.id },
    include: { deal: { select: { dealChannel: true } } },
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && row.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!row.contactPhone) {
    return NextResponse.json(
      { error: "no_phone", message: "No contact phone on this design; cannot send via WhatsApp." },
      { status: 422 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Build the list of items to send. If formats wasn't supplied (legacy
  // callers), fall back to the single imageUrl.
  type Item = {
    format: "2d" | "3d-image" | "3d-video";
    url: string;
    mediaType: "image" | "video";
    fileExt: "png" | "mp4";
  };
  const requested = parsed.data.formats ??
    (row.imageUrl ? (["2d"] as const) : []);
  const items: Item[] = [];
  for (const f of FORMAT_ORDER) {
    if (!requested.includes(f)) continue;
    const url =
      f === "2d"
        ? row.image2dUrl ?? row.imageUrl
        : f === "3d-image"
          ? row.image3dUrl
          : row.video3dUrl;
    if (!url) {
      return NextResponse.json(
        {
          error: "missing_url",
          message: `No ${f} media saved for this design — regenerate it in the wizard.`,
        },
        { status: 422 }
      );
    }
    items.push({
      format: f,
      url,
      mediaType: f === "3d-video" ? "video" : "image",
      fileExt: f === "3d-video" ? "mp4" : "png",
    });
  }

  if (items.length === 0) {
    return NextResponse.json(
      { error: "no_formats", message: "Pick at least one format to send." },
      { status: 422 }
    );
  }

  const baseCaption =
    row.caption?.trim() ||
    `Court design ${row.number} from Fitoverse — ${row.customerName}`;

  // CRM-channel deals: hand off to WhatsApp Web/App instead of sending via
  // the Cloud API directly — same reasoning as the quotation /send route
  // (see its own comment, and docs/DECISIONS.md). Click-to-chat can only
  // pre-fill TEXT, never attach a file, so the message links to each
  // selected format instead — these are genuinely public Vercel Blob URLs
  // (uploadToBlob always uses access: "public").
  if (row.deal?.dealChannel === "crm") {
    await prisma.courtImage.update({
      where: { id: params.id },
      data: { status: "sent", sentAt: new Date() },
    });
    if (row.dealId) {
      await advanceDealStageIfEarlier({
        dealId: row.dealId,
        targetStageSlug: "design_shared",
        userId: user.id,
        note: `Court design ${row.number} sent`,
      });
    }
    const links = items.map((i) => `${i.format}: ${i.url}`).join("\n");
    const message = `${baseCaption}\n\n${links}`;
    const digits = row.contactPhone.replace(/[^0-9]/g, "");
    const whatsappWebUrl = `https://api.whatsapp.com/send/?phone=${digits}&text=${encodeURIComponent(message)}&type=phone_number&app_absent=0`;
    return NextResponse.json({ ok: true, sent: [], whatsappWebUrl });
  }

  type Sent = {
    format: string;
    waMessageId: string;
    url: string | null;
    type: "image" | "video" | "text";
  };
  const sent: Sent[] = [];

  // Send the caption as a preceding text message so WhatsApp displays
  // it as a clear intro rather than hiding it under inline media.
  if (baseCaption) {
    try {
      const t = await sendText({ to: row.contactPhone, body: baseCaption });
      sent.push({ format: "caption", waMessageId: t.waMessageId, url: null, type: "text" });
    } catch (err) {
      const e = describeMetaError(err);
      return NextResponse.json(
        { error: `WhatsApp send failed on caption: ${e.message}`, code: e.code },
        { status: 502 }
      );
    }
  }

  for (const item of items) {
    try {
      const r = await sendMedia({
        to: row.contactPhone,
        mediaType: item.mediaType,
        url: item.url,
        // No inline caption — the intro text delivered it up-front.
      });
      sent.push({
        format: item.format,
        waMessageId: r.waMessageId,
        url: item.url,
        type: item.mediaType === "video" ? "video" : "image",
      });
    } catch (err) {
      const e = describeMetaError(err);
      return NextResponse.json(
        {
          error: `WhatsApp send failed on ${item.format}: ${e.message}`,
          code: e.code,
          sentSoFar: sent,
        },
        { status: 502 }
      );
    }
  }

  await prisma.courtImage.update({
    where: { id: params.id },
    data: { status: "sent", sentAt: new Date() },
  });

  // Same forward-only advance as the quotation send route — a design
  // actually going out is real progress, moves the deal to "Design Shared"
  // if it hasn't gotten there yet (see docs/DECISIONS.md).
  if (row.dealId) {
    await advanceDealStageIfEarlier({
      dealId: row.dealId,
      targetStageSlug: "design_shared",
      userId: user.id,
      note: `Court design ${row.number} sent`,
    });
  }

  if (row.conversationId) {
    // Mirror each sent item as its own inbox message so the thread shows
    // exactly what the customer received. Text-caption message first,
    // then each media.
    for (const s of sent) {
      if (s.type === "text") {
        await prisma.message
          .create({
            data: {
              conversationId: row.conversationId,
              direction: "outbound",
              type: "text",
              body: baseCaption,
              waMessageId: s.waMessageId,
              status: "sent",
              sentByUserId: user.id,
            },
          })
          .catch(() => null);
        continue;
      }
      const isVideo = s.type === "video";
      await prisma.message
        .create({
          data: {
            conversationId: row.conversationId,
            direction: "outbound",
            type: isVideo ? "video" : "image",
            body: `Court design ${row.number} sent (${s.format})`,
            mediaUrl: s.url ?? undefined,
            mediaMimeType: isVideo ? "video/mp4" : "image/png",
            mediaFileName: `${row.number}-${s.format}.${isVideo ? "mp4" : "png"}`,
            waMessageId: s.waMessageId,
            status: "sent",
            sentByUserId: user.id,
          },
        })
        .catch(() => null);
    }
    await prisma.conversation.update({
      where: { id: row.conversationId },
      data: { lastOutboundAt: new Date() },
    });
  }

  return NextResponse.json({ ok: true, sent });
}
