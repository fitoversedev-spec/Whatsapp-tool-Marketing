// Render the quote PDF, upload to Vercel Blob, and send to the customer
// via WhatsApp as a document message. Saves pdfUrl + flips status to
// "sent" + records sentAt.
//
// Idempotency: if the quotation already has pdfUrl + status "sent", we
// re-send the existing blob rather than regenerating.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renderQuotationPdf } from "@/lib/quotation/pdf";
import { uploadToBlob } from "@/lib/media";
import { sendMedia, describeMetaError } from "@/lib/whatsapp";
import type { QuoteLineItem } from "@/lib/quotation/calculator";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = await prisma.quotation.findUnique({ where: { id: params.id } });
  if (!q) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && q.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!q.contactPhone) {
    return NextResponse.json(
      { error: "No contact phone on this quotation; cannot send via WhatsApp" },
      { status: 422 }
    );
  }

  // 1. Render PDF (or reuse cached)
  let pdfUrl = q.pdfUrl;
  let fileName = `${q.number}-${q.customerName.replace(/[^a-zA-Z0-9]+/g, "-")}.pdf`;
  if (!pdfUrl) {
    try {
      const lineItems = JSON.parse(q.lineItems) as QuoteLineItem[];
      const pdfBuffer = await renderQuotationPdf({
        number: q.number,
        customerName: q.customerName,
        sport: q.sport,
        lengthFt: q.lengthFt,
        widthFt: q.widthFt,
        lineItems,
        subtotal: Number(q.subtotal),
        gstAmount: Number(q.gstAmount),
        grandTotal: Number(q.grandTotal),
        notes: q.notes,
        quoteDate: q.quoteDate,
        validityDays: q.validityDays,
      });
      const uploaded = await uploadToBlob({
        bytes: pdfBuffer,
        fileName,
        mimeType: "application/pdf",
        folder: "quotations",
      });
      pdfUrl = uploaded.url;
    } catch (err) {
      console.error("[quotation/send] pdf render/upload failed", err);
      return NextResponse.json(
        { error: "Failed to render PDF: " + (err instanceof Error ? err.message : String(err)) },
        { status: 500 }
      );
    }
  }

  // 2. Send via WhatsApp as document
  let waMessageId = "";
  try {
    const r = await sendMedia({
      to: q.contactPhone,
      mediaType: "document",
      url: pdfUrl,
      caption: `Quotation ${q.number} from Fitoverse — total ₹${Number(q.grandTotal).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      filename: fileName,
    });
    waMessageId = r.waMessageId;
  } catch (err) {
    const e = describeMetaError(err);
    return NextResponse.json(
      { error: `WhatsApp send failed: ${e.message}`, code: e.code },
      { status: 502 }
    );
  }

  // 3. Update quotation + mirror to inbox if conversation exists
  await prisma.quotation.update({
    where: { id: params.id },
    data: {
      pdfUrl,
      status: "sent",
      sentAt: new Date(),
    },
  });

  if (q.conversationId) {
    await prisma.message
      .create({
        data: {
          conversationId: q.conversationId,
          direction: "outbound",
          type: "document",
          body: `📄 Quotation ${q.number} sent`,
          mediaUrl: pdfUrl,
          mediaMimeType: "application/pdf",
          mediaFileName: fileName,
          waMessageId,
          status: "sent",
          sentByUserId: user.id,
        },
      })
      .catch(() => null);
    await prisma.conversation.update({
      where: { id: q.conversationId },
      data: { lastOutboundAt: new Date() },
    });
  }

  return NextResponse.json({ ok: true, pdfUrl, waMessageId });
}
