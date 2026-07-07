// Build the self-contained "drag-to-rotate" 3D HTML file from pre-rendered
// spin frames and upload it to Blob. Optionally send it to the customer
// over WhatsApp as a Document (the only in-chat way to hand them a file
// that opens in their browser and rotates — no hosted viewer, no Vercel
// dependency once delivered; the Blob URL is just the transport WhatsApp
// fetches the file from at send time).
//
// POST JSON:
//   customerName, plotLabel, frames: string[] (JPEG data URLs)
//   send?, contactPhone?, conversationId?, email?

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { uploadToBlob } from "@/lib/media";
import { prisma } from "@/lib/prisma";
import { sendText, sendMedia } from "@/lib/whatsapp";
import { renderSpinViewerHtml } from "@/lib/court-image/spin-viewer";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  const frames: string[] = Array.isArray(body.frames)
    ? body.frames.filter(
        (f: unknown) => typeof f === "string" && f.startsWith("data:image/"),
      )
    : [];
  if (frames.length < 2) {
    return NextResponse.json({ error: "no_frames" }, { status: 400 });
  }

  const customerName = String(body.customerName ?? "");
  const plotLabel = String(body.plotLabel ?? "");

  const html = renderSpinViewerHtml({
    title: customerName ? `${customerName} — court` : "Court design",
    subtitle: plotLabel,
    frames,
  });

  const uploaded = await uploadToBlob({
    bytes: Buffer.from(html, "utf8"),
    fileName: `fitoverse-3d-rotate-${Date.now()}.html`,
    mimeType: "text/html",
    folder: "spin-file",
  });

  // Optional WhatsApp send as a Document.
  let sent = false;
  if (body.send && typeof body.contactPhone === "string" && body.contactPhone) {
    try {
      const caption =
        `Fitoverse 3D court design${customerName ? ` for ${customerName}` : ""}. ` +
        `Open this file in your phone browser and drag left/right to rotate it in all angles.`;
      await sendText({ to: body.contactPhone, body: caption }).catch(() => null);
      await sendMedia({
        to: body.contactPhone,
        mediaType: "document",
        url: uploaded.url,
        caption,
        filename: "fitoverse-3d-rotate.html",
      });
      sent = true;
      if (typeof body.conversationId === "string" && body.conversationId) {
        await prisma.message
          .create({
            data: {
              conversationId: body.conversationId,
              direction: "outbound",
              type: "document",
              body: "[3D spin] rotatable court file",
              mediaUrl: uploaded.url,
              status: "sent",
            },
          })
          .catch(() => null);
        await prisma.conversation
          .update({
            where: { id: body.conversationId },
            data: { lastOutboundAt: new Date() },
          })
          .catch(() => null);
      }
    } catch (err) {
      console.error("[spin-file] send failed", err);
    }
  }

  // Optional email — the HTML file as an attachment.
  let emailed: boolean | "not_configured" = false;
  if (body.email && typeof body.email === "string") {
    if (!isEmailConfigured()) {
      emailed = "not_configured";
    } else {
      const res = await sendEmail({
        to: body.email,
        subject: `Fitoverse 3D court design${customerName ? ` — ${customerName}` : ""}`,
        html: `<p>Hi,</p><p>Attached is your Fitoverse court design as an interactive 3D file. Open it in a browser and drag to rotate it in all angles.</p><p>— Fitoverse</p>`,
        attachments: [
          {
            filename: "fitoverse-3d-rotate.html",
            content: Buffer.from(html, "utf8").toString("base64"),
          },
        ],
      });
      emailed = res.sent;
    }
  }

  return NextResponse.json({ url: uploaded.url, sent, emailed });
}
