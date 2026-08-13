// Render the invoice PDF, upload to Blob, and deliver it — mirroring the
// quotation send flow exactly. For CRM-channel deals we hand off a WhatsApp
// click-to-chat link to the public /inv/[id] page (the rep sends from their own
// number); for an inbound WhatsApp conversation we send the PDF via the Cloud
// API and mirror it into the inbox thread.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureInvoicePdfUrl, invoiceFileName } from "@/lib/invoice/render";
import { sendMedia, sendText, describeMetaError } from "@/lib/whatsapp";
import { resolveWhatsAppDelivery } from "@/lib/whatsapp-delivery";

export const runtime = "nodejs";
export const maxDuration = 60;

const APP_URL = process.env.APP_URL ?? "https://whatsapp-tool-marketing.vercel.app";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const inv = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      quotation: { select: { conversationId: true } },
    },
  });
  if (!inv) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && inv.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!inv.contactPhone) {
    return NextResponse.json({ error: "No contact phone on this invoice; cannot send via WhatsApp" }, { status: 422 });
  }

  const fileName = invoiceFileName(inv.number);

  // 1. Render (or reuse cached) PDF.
  let pdfUrl: string | null;
  try {
    pdfUrl = await ensureInvoicePdfUrl(params.id);
  } catch (err) {
    console.error("[invoice/send] pdf render/upload failed", err);
    return NextResponse.json({ error: "Failed to render PDF: " + (err instanceof Error ? err.message : String(err)) }, { status: 500 });
  }
  if (!pdfUrl) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Sending marks a fresh invoice "sent", but never regresses paid/partial — and
  // never an overdue invoice back to "sent" (it's still past due; sentAt already
  // records the send), which would transiently drop it from the overdue figure.
  const nextStatus = inv.status === "issued" ? "sent" : inv.status;
  const introText = `Invoice ${inv.number} from Fitoverse — total ₹${Number(inv.grandTotal).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  // Route by whether the customer has an OPEN 24h WhatsApp session (located by
  // phone number — see resolveWhatsAppDelivery). Same rule as the quotation /
  // court-design send routes.
  const delivery = await resolveWhatsAppDelivery({
    contactPhone: inv.contactPhone,
    linkedConversationId: inv.quotation?.conversationId ?? null,
  });

  // 2a. No open session → click-to-chat link (rep sends from their own number).
  if (delivery.mode === "whatsapp-web") {
    await prisma.invoice.update({ where: { id: params.id }, data: { pdfUrl, status: nextStatus, sentAt: inv.sentAt ?? new Date() } });
    const message = `${introText}\n\nView/download: ${APP_URL}/inv/${inv.id}`;
    const digits = delivery.normalizedPhone ?? inv.contactPhone.replace(/[^0-9]/g, "");
    const whatsappWebUrl = `https://api.whatsapp.com/send/?phone=${digits}&text=${encodeURIComponent(message)}&type=phone_number&app_absent=0`;
    return NextResponse.json({ ok: true, pdfUrl, waMessageId: null, whatsappWebUrl });
  }

  // 2b. Inbound conversation → Cloud API document send.
  let waMessageId = "";
  let captionMessageId: string | null = null;
  const sendTo = delivery.normalizedPhone ?? inv.contactPhone;
  try {
    const t = await sendText({ to: sendTo, body: introText });
    captionMessageId = t.waMessageId;
    const r = await sendMedia({ to: sendTo, mediaType: "document", url: pdfUrl, filename: fileName });
    waMessageId = r.waMessageId;
  } catch (err) {
    const e = describeMetaError(err);
    return NextResponse.json({ error: `WhatsApp send failed: ${e.message}`, code: e.code }, { status: 502 });
  }

  await prisma.invoice.update({ where: { id: params.id }, data: { pdfUrl, status: nextStatus, sentAt: inv.sentAt ?? new Date() } });

  // Mirror into the customer's conversation thread (linked, or found by phone).
  const conversationId = delivery.conversationId;
  if (conversationId) {
    if (captionMessageId) {
      await prisma.message
        .create({ data: { conversationId, direction: "outbound", type: "text", body: introText, waMessageId: captionMessageId, status: "sent", sentByUserId: user.id } })
        .catch(() => null);
    }
    await prisma.message
      .create({
        data: {
          conversationId,
          direction: "outbound",
          type: "document",
          body: `📄 Invoice ${inv.number} sent`,
          mediaUrl: pdfUrl,
          mediaMimeType: "application/pdf",
          mediaFileName: fileName,
          waMessageId,
          status: "sent",
          sentByUserId: user.id,
        },
      })
      .catch(() => null);
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastOutboundAt: new Date() } }).catch(() => null);
  }

  return NextResponse.json({ ok: true, pdfUrl, waMessageId });
}
