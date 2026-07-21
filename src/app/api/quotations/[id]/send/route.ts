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
import { getSportCatalogueBytes, mergeCatalogueIntoQuote } from "@/lib/quotation/attach-catalogue";
import { uploadToBlob } from "@/lib/media";
import { sendMedia, sendText, describeMetaError } from "@/lib/whatsapp";
import { advanceDealStageIfEarlier } from "@/lib/funnel/transitionDeal";
import { z } from "zod";

// Optional caption/contactPhone in the request body — override the row's
// own values if provided. contactPhone lets a quote created with no phone
// (the standalone /quotations "New Quote" flow, or any historical draft —
// see docs/DECISIONS.md) be supplied at send time instead of requiring a
// separate edit step first.
const bodySchema = z.object({
  caption: z.string().max(1024).nullable().optional(),
  contactPhone: z.string().min(5).max(30).optional(),
});
import type { QuoteLineItem } from "@/lib/quotation/calculator";

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
    include: { deal: { select: { dealChannel: true } } },
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

  // 1. Render PDF (or reuse cached)
  let pdfUrl = q.pdfUrl;
  let fileName = `${q.number}-${q.customerName.replace(/[^a-zA-Z0-9]+/g, "-")}.pdf`;
  if (!pdfUrl) {
    try {
      // Fetch/render the catalogue CONCURRENTLY with the quote — the
      // admin-uploaded override can be several MB, so waiting until AFTER
      // the quote renders to start that download would add it to the
      // critical path.
      const cataloguePromise = getSportCatalogueBytes(q.sport);
      const driveLinkPromise = prisma.setting
        .findUnique({ where: { key: `project_drive_link_${q.sport}` } })
        .then((s) => s?.value ?? null);
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
        driveLink: await driveLinkPromise,
      });
      const withCatalogue = await mergeCatalogueIntoQuote(pdfBuffer, await cataloguePromise);
      const uploaded = await uploadToBlob({
        bytes: Buffer.from(withCatalogue),
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

  // CRM-channel deals: hand off to WhatsApp Web/App instead of sending via
  // the Cloud API directly. Cloud API sends need either an active 24h
  // customer-service session or a pre-approved template; CRM-originated
  // contacts (cold leads, not an inbound WhatsApp conversation) usually
  // have neither, so a human sends it manually from their own WhatsApp —
  // same message, just not through Meta's API. See docs/DECISIONS.md.
  // WhatsApp click-to-chat can only pre-fill TEXT, never attach a file, so
  // the message links to the PDF instead — pdfUrl is a genuinely public
  // Vercel Blob URL (uploadToBlob always uses access: "public"), unlike
  // the session-gated /api/quotations/[id]/pdf route the app itself uses.
  if (q.deal?.dealChannel === "crm") {
    await prisma.quotation.update({
      where: { id: params.id },
      data: { pdfUrl, status: "sent", sentAt: new Date() },
    });
    if (q.dealId) {
      await advanceDealStageIfEarlier({
        dealId: q.dealId,
        targetStageSlug: "quotation_sent",
        userId: user.id,
        note: `Quotation ${q.number} sent`,
      });
    }
    const introText =
      q.caption?.trim() ||
      `Quotation ${q.number} from Fitoverse — total ₹${Number(q.grandTotal).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    const message = `${introText}\n\nView/download: ${pdfUrl}`;
    const digits = q.contactPhone.replace(/[^0-9]/g, "");
    const whatsappWebUrl = `https://api.whatsapp.com/send/?phone=${digits}&text=${encodeURIComponent(message)}&type=phone_number&app_absent=0`;
    return NextResponse.json({ ok: true, pdfUrl, waMessageId: null, whatsappWebUrl });
  }

  // 2. Send caption as a preceding text message (if provided) then the
  //    PDF as a document. Splitting them fixes the "caption invisible"
  //    quirk WhatsApp has with document-type captions — customers see
  //    the intro text clearly, then the file below it.
  const captionText =
    q.caption?.trim() ||
    `Quotation ${q.number} from Fitoverse — total ₹${Number(q.grandTotal).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  let captionMessageId: string | null = null;
  let waMessageId = "";
  try {
    if (captionText) {
      const t = await sendText({ to: q.contactPhone, body: captionText });
      captionMessageId = t.waMessageId;
    }
    const r = await sendMedia({
      to: q.contactPhone,
      mediaType: "document",
      url: pdfUrl,
      // No inline caption — the intro text message already delivered it.
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

  // A quote actually going out is real progress — advance the deal to
  // "Quotation Sent" if it hasn't reached that point yet (never regresses
  // a deal already further along). This also write-throughs to the legacy
  // /pipeline board via transitionDeal()'s own sync (see docs/DECISIONS.md).
  if (q.dealId) {
    await advanceDealStageIfEarlier({
      dealId: q.dealId,
      targetStageSlug: "quotation_sent",
      userId: user.id,
      note: `Quotation ${q.number} sent`,
    });
  }

  if (q.conversationId) {
    // Mirror the caption text (if sent) + the PDF into the inbox thread
    // so the conversation shows both, matching what the customer sees.
    if (captionMessageId) {
      await prisma.message
        .create({
          data: {
            conversationId: q.conversationId,
            direction: "outbound",
            type: "text",
            body: captionText,
            waMessageId: captionMessageId,
            status: "sent",
            sentByUserId: user.id,
          },
        })
        .catch(() => null);
    }
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
