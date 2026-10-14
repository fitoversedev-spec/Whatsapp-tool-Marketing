// Render the quote PDF, upload to Vercel Blob, and send to the customer
// via WhatsApp as a document message. Saves pdfUrl + flips status to
// "sent" + records sentAt.
//
// The PDF is the same one the preview and the customer's /q link show: a saved
// copy is reused while the quote is unchanged and rebuilt after an edit (see
// lib/quotation/pdf-cache.ts).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureQuotationPdf, quotationFileName } from "@/lib/quotation/pdf-cache";
import { resolveWhatsAppDelivery } from "@/lib/whatsapp-delivery";
import {
  isRecentlySent,
  markQuotationSent,
  mirrorQuotationToInbox,
  sendQuotationOverCloudApi,
  whatsAppWebHandoff,
} from "@/lib/quotation/service";
import { z } from "zod";

// Optional caption/contactPhone in the request body — override the row's
// own values if provided. contactPhone lets a quote created with no phone
// (the standalone /quotations "New Quote" flow, or any historical draft —
// see docs/DECISIONS.md) be supplied at send time instead of requiring a
// separate edit step first.
const bodySchema = z.object({
  caption: z.string().max(1024).nullable().optional(),
  contactPhone: z.string().min(5).max(30).optional(),
  // Set after the user confirmed "Send it again?" (see RESEND_CONFIRM_MS).
  confirmResend: z.boolean().optional(),
});

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  const bodyCaption = parsed.success ? parsed.data.caption : null;
  const bodyContactPhone = parsed.success ? parsed.data.contactPhone : undefined;

  const q = await prisma.quotation.findUnique({
    where: { id: params.id },
  });
  if (!q) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // If a caption came in via the body (from the wizard), persist it so
  // re-sends from the /quotations list use the same wording. Same for
  // contactPhone — lets a quote created with none (the standalone
  // "New Quote" flow previously had no field for it at all — see
  // docs/DECISIONS.md) get one supplied right here instead of failing.
  if (bodyCaption !== undefined && bodyCaption !== q.caption) {
    await prisma.quotation.update({
      where: { id: params.id },
      data: { caption: bodyCaption },
    });
    q.caption = bodyCaption;
  }
  if (bodyContactPhone && bodyContactPhone !== q.contactPhone) {
    await prisma.quotation.update({
      where: { id: params.id },
      data: { contactPhone: bodyContactPhone },
    });
    q.contactPhone = bodyContactPhone;
  }
  if (user.role !== "admin" && q.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!q.contactPhone) {
    return NextResponse.json(
      { error: "No contact phone on this quotation; cannot send via WhatsApp" },
      { status: 422 }
    );
  }
  // The resend window (RESEND_CONFIRM_MS) lives in lib/quotation/service.ts.
  if (isRecentlySent(q.sentAt) && !(parsed.success && parsed.data.confirmResend)) {
    return NextResponse.json({ error: "recently_sent", sentAt: q.sentAt?.toISOString() }, { status: 409 });
  }

  // 1. The saved PDF for the quote exactly as it is now — same inputs as the
  //    preview and the customer's /q link; rebuilt if it was edited since.
  const fileName = quotationFileName(q);
  let pdfUrl: string;
  try {
    pdfUrl = (await ensureQuotationPdf(q)).url;
  } catch (err) {
    console.error("[quotation/send] pdf render/upload failed", err);
    return NextResponse.json(
      { error: "Failed to render PDF: " + (err instanceof Error ? err.message : String(err)) },
      { status: 500 }
    );
  }

  // Route by whether the customer has an OPEN 24h WhatsApp session (located
  // by phone number — see resolveWhatsAppDelivery). An open session → send
  // directly from the marketing number below. No open session (cold CRM lead,
  // or the window has lapsed) → hand off to WhatsApp Web/App, since the Cloud
  // API would reject a free-form file send; a human sends it from their own
  // WhatsApp. Click-to-chat can only pre-fill TEXT, never attach a file, so the
  // message links to the PDF instead. Links through /q/[id] (this app's own
  // domain) rather than the raw pdfUrl — the Vercel Blob storage subdomain
  // reads as a random/untrustworthy link to a customer; see docs/DECISIONS.md.
  // /q/[id] is itself unauthenticated (unlike the session-gated
  // /api/quotations/[id]/pdf the app uses internally) and just 302s to pdfUrl,
  // which is genuinely public either way.
  const delivery = await resolveWhatsAppDelivery({
    contactPhone: q.contactPhone,
    linkedConversationId: q.conversationId,
  });
  if (delivery.mode === "whatsapp-web") {
    // Only the request that actually turns the draft into "sent" schedules
    // the follow-up (two quick sends must not create two reminders). Deals are
    // confirmed projects and never change stage on a send. The first send gets
    // the 3-day follow-up (on the customer when known).
    await markQuotationSent({
      quotation: q,
      pdfUrl,
      actorUserId: user.id,
      followUpConversationId: q.conversationId,
    });
    const { whatsappWebUrl } = whatsAppWebHandoff({ ...q, contactPhone: q.contactPhone }, delivery);
    return NextResponse.json({ ok: true, pdfUrl, waMessageId: null, whatsappWebUrl });
  }

  // 2. Send caption as a preceding text message (if provided) then the
  //    PDF as a document. Splitting them fixes the "caption invisible"
  //    quirk WhatsApp has with document-type captions — customers see
  //    the intro text clearly, then the file below it.
  const sendTo = delivery.normalizedPhone ?? q.contactPhone;
  const sent = await sendQuotationOverCloudApi({ quotation: q, sendTo, pdfUrl, fileName });
  if (!sent.ok) {
    return NextResponse.json(
      { error: `WhatsApp send failed: ${sent.message}`, code: sent.code },
      { status: 502 }
    );
  }
  const { captionText, captionMessageId, waMessageId } = sent;

  // 3. Update quotation + mirror to inbox if conversation exists. The first send
  //    gets the 3-day follow-up (on the customer when known, else the chat).
  await markQuotationSent({
    quotation: q,
    pdfUrl,
    actorUserId: user.id,
    followUpConversationId: q.conversationId ?? delivery.conversationId ?? null,
  });

  const mirrorConversationId = delivery.conversationId;
  if (mirrorConversationId) {
    await mirrorQuotationToInbox({
      conversationId: mirrorConversationId,
      quotationNumber: q.number,
      captionText,
      captionMessageId,
      pdfUrl,
      fileName,
      waMessageId,
      actorUserId: user.id,
    });
  }

  return NextResponse.json({ ok: true, pdfUrl, waMessageId });
}
