// Send a court-image design to the customer via WhatsApp as an image
// message. Pulls the PNG that the canvas already uploaded to blob storage
// during save; if the row has no imageUrl yet, the caller (wizard Step 3)
// is expected to upload it via /api/media/upload first and then PATCH the
// row before hitting this endpoint.
//
// Mirrors the quotation send route so the audit/inbox-mirror flow stays
// consistent.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendMedia, describeMetaError } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const row = await prisma.courtImage.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && row.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!row.imageUrl) {
    return NextResponse.json(
      { error: "no_image", message: "Design has no rendered PNG yet — save the editor first." },
      { status: 422 }
    );
  }
  if (!row.contactPhone) {
    return NextResponse.json(
      { error: "no_phone", message: "No contact phone on this design; cannot send via WhatsApp." },
      { status: 422 }
    );
  }

  const caption = row.caption ??
    `Court design ${row.number} from Fitoverse — ${row.customerName}`;

  let waMessageId = "";
  try {
    const r = await sendMedia({
      to: row.contactPhone,
      mediaType: "image",
      url: row.imageUrl,
      caption,
    });
    waMessageId = r.waMessageId;
  } catch (err) {
    const e = describeMetaError(err);
    return NextResponse.json(
      { error: `WhatsApp send failed: ${e.message}`, code: e.code },
      { status: 502 }
    );
  }

  await prisma.courtImage.update({
    where: { id: params.id },
    data: { status: "sent", sentAt: new Date() },
  });

  // Mirror to inbox if linked to a conversation, so the design shows in
  // the chat thread alongside other messages.
  if (row.conversationId) {
    await prisma.message
      .create({
        data: {
          conversationId: row.conversationId,
          direction: "outbound",
          type: "image",
          body: `Court design ${row.number} sent`,
          mediaUrl: row.imageUrl,
          mediaMimeType: "image/png",
          mediaFileName: `${row.number}.png`,
          waMessageId,
          status: "sent",
          sentByUserId: user.id,
        },
      })
      .catch(() => null);
    await prisma.conversation.update({
      where: { id: row.conversationId },
      data: { lastOutboundAt: new Date() },
    });
  }

  return NextResponse.json({ ok: true, imageUrl: row.imageUrl, waMessageId });
}
