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
import { sendMedia, describeMetaError } from "@/lib/whatsapp";

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

  const row = await prisma.courtImage.findUnique({ where: { id: params.id } });
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
    row.caption ?? `Court design ${row.number} from Fitoverse — ${row.customerName}`;

  const sent: Array<{ format: string; waMessageId: string; url: string }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // Only the first message carries the caption — matches what WhatsApp
    // clients render visually.
    const caption = i === 0 ? baseCaption : undefined;
    try {
      const r = await sendMedia({
        to: row.contactPhone,
        mediaType: item.mediaType,
        url: item.url,
        caption,
      });
      sent.push({ format: item.format, waMessageId: r.waMessageId, url: item.url });
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

  if (row.conversationId) {
    // Mirror each sent item as its own inbox message so the thread shows
    // exactly what the customer received.
    for (const s of sent) {
      const isVideo = s.format === "3d-video";
      await prisma.message
        .create({
          data: {
            conversationId: row.conversationId,
            direction: "outbound",
            type: isVideo ? "video" : "image",
            body: `Court design ${row.number} sent (${s.format})`,
            mediaUrl: s.url,
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
