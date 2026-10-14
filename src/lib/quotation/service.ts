// Quotation logic shared by the human routes (src/app/api/quotations/**) and the
// AI Sales Agent's quote tools (src/lib/agent/quotes/**). Everything here was
// lifted out of those routes unchanged so both callers do exactly the same thing:
//
//   - numbering:   nextSequenceForYear, createQuotationWithNumber (P2002 retry)
//   - deal sync:   setDealQuotedValue, demotePrimaryQuotes, syncConversationDealValue,
//                  syncDealAccountClassification, writeDealLineItems
//   - sending:     RESEND_CONFIRM_MS, isRecentlySent, quoteCaptionText, whatsAppWebHandoff,
//                  markQuotationSent, sendQuotationOverCloudApi, mirrorQuotationToInbox
//
// No function here knows who the caller is: the route (or tool) does the
// authentication and the permission checks, then calls these.

import type { Deal, Prisma, Quotation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scheduleQuoteFollowUp } from "@/lib/crm/contactLinks";
import { describeMetaError, sendMedia, sendText } from "@/lib/whatsapp";
import type { WhatsAppDelivery } from "@/lib/whatsapp-delivery";
import { buildQuotationNumber, type QuoteLineItem } from "./calculator";

// ── numbering ───────────────────────────────────────────────────────────────

// Find the next sequential number for a given calendar year by parsing
// the highest existing FIT-QT-YYYY-NNN row. Returns 1 if no quotations
// exist yet that year.
export async function nextSequenceForYear(year: number): Promise<number> {
  const prefix = `FIT-QT-${year}-`;
  const latest = await prisma.quotation.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  if (!latest) return 1;
  const seqStr = latest.number.slice(prefix.length);
  const seq = parseInt(seqStr, 10);
  if (!Number.isFinite(seq)) return 1;
  return seq + 1;
}

export const QUOTE_NUMBER_ATTEMPTS = 6;

/**
 * Create the quotation row with the next free number. Two quotes created at the
 * same moment can pick the same number; the unique index rejects the second
 * (Prisma P2002) and that one tries again with the next number. Any other error
 * is thrown straight away so unrelated bugs aren't masked. Returns null when
 * every attempt collided.
 */
export async function createQuotationWithNumber(args: {
  year: number;
  nextSeq: number;
  data: Omit<Prisma.QuotationUncheckedCreateInput, "number">;
}): Promise<Quotation | null> {
  let lastError: unknown = null;
  let nextSeq = args.nextSeq;
  for (let attempt = 0; attempt < QUOTE_NUMBER_ATTEMPTS; attempt++) {
    try {
      return await prisma.quotation.create({
        data: { number: buildQuotationNumber(args.year, nextSeq - 1), ...args.data },
      });
    } catch (err) {
      lastError = err;
      // P2002 = unique constraint failure. Only retry that one; bubble
      // everything else immediately so unrelated bugs aren't masked.
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") throw err;
      nextSeq += 1;
    }
  }
  console.error("[quotations] number collision after retries", lastError);
  return null;
}

// ── deal sync ───────────────────────────────────────────────────────────────

/** A new quote on a deal sets the deal's quoted value (and, if given, its site city / lead source). Best effort: null on failure. */
export function setDealQuotedValue(args: {
  dealId: string;
  quotedValue: number;
  siteCity?: string | null;
  leadSourceId?: string | null;
}): Promise<Deal | null> {
  return prisma.deal
    .update({
      where: { id: args.dealId },
      data: {
        quotedValue: args.quotedValue,
        ...(args.siteCity ? { siteCity: args.siteCity } : {}),
        ...(args.leadSourceId ? { leadSourceId: args.leadSourceId } : {}),
      },
    })
    .catch(() => null);
}

/** The newest quote on a deal becomes its primary one. */
export function demotePrimaryQuotes(dealId: string) {
  return prisma.quotation.updateMany({ where: { dealId, isPrimary: true }, data: { isPrimary: false } });
}

/** Keep the WhatsApp chat's deal value in step with the deal. Best effort. */
export function syncConversationDealValue(
  deal: Pick<Deal, "conversationId" | "wonValue" | "quotedValue"> | null,
): Promise<unknown> | null {
  if (!deal?.conversationId) return null;
  return prisma.conversation
    .update({
      where: { id: deal.conversationId },
      data: { dealValue: deal.wonValue ?? deal.quotedValue },
    })
    .catch(() => null);
}

/** Customer segment / business type chosen in the wizard land on the deal's account. Best effort. */
export function syncDealAccountClassification(args: {
  dealId: string;
  customerProfileId?: string | null;
  businessType?: string | null;
}): Promise<unknown> | null {
  if (!args.customerProfileId && !args.businessType) return null;
  return prisma.deal
    .findUnique({ where: { id: args.dealId }, select: { accountId: true } })
    .then((d) =>
      d
        ? prisma.account
            .update({
              where: { id: d.accountId },
              data: {
                ...(args.customerProfileId ? { customerProfileId: args.customerProfileId } : {}),
                ...(args.businessType ? { businessType: args.businessType } : {}),
              },
            })
            .catch(() => null)
        : null,
    );
}

/**
 * DealLineItem rows for analytics (one per included line). The quote's own JSON
 * snapshot is already saved; this is best effort and never throws. With
 * `replaceExisting` the quote's earlier rows are removed first.
 */
export async function writeDealLineItems(args: {
  dealId: string;
  quotationId: string;
  sport: string;
  lineItems: QuoteLineItem[];
  replaceExisting?: boolean;
}): Promise<void> {
  try {
    const sport = await prisma.sport.findUnique({ where: { slug: args.sport } });
    if (args.replaceExisting) await prisma.dealLineItem.deleteMany({ where: { quotationId: args.quotationId } });
    const included = args.lineItems.filter((li) => li.included);
    if (included.length) {
      await prisma.dealLineItem.createMany({
        data: included.map((li) => ({
          dealId: args.dealId,
          quotationId: args.quotationId,
          productId: li.productId ?? null,
          sportId: sport?.id ?? null,
          label: li.name,
          quantity: li.areaSqFt,
          unit: li.unit ?? null,
          rate: li.ratePerSqFt,
          amount: li.total,
          isEnquiryOnly: false,
        })),
      });
    }
  } catch (err) {
    console.error("[quotations] DealLineItem write failed", err);
  }
}

// ── sending ─────────────────────────────────────────────────────────────────

// Same convention as staffCommands.ts's own APP_URL constant.
const APP_URL = process.env.APP_URL ?? "https://whatsapp-tool-marketing.vercel.app";

// A second send of the same quote within this window needs the user's
// explicit confirm — a double click, a second tab or a retried request must
// not send the customer a duplicate (src/lib/quotation/send-client.ts asks).
export const RESEND_CONFIRM_MS = 10 * 60 * 1000;

export function isRecentlySent(sentAt: Date | null | undefined, now: number = Date.now()): boolean {
  return !!sentAt && now - sentAt.getTime() < RESEND_CONFIRM_MS;
}

/** The intro text sent before the PDF: the saved caption, else a one-line default with the total. */
export function quoteCaptionText(q: { number: string; caption: string | null; grandTotal: { toString(): string } | number }): string {
  return (
    q.caption?.trim() ||
    `Quotation ${q.number} from Fitoverse — total ₹${Number(q.grandTotal).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
  );
}

/**
 * Outside the 24 h window the Cloud API would reject a file, so a person sends
 * it from their own WhatsApp: click-to-chat can only pre-fill TEXT, so the
 * message links to the quote on this app's own domain (/q/[id]).
 */
export function whatsAppWebHandoff(
  q: { id: string; number: string; caption: string | null; grandTotal: { toString(): string } | number; contactPhone: string },
  delivery: Pick<WhatsAppDelivery, "normalizedPhone">,
): { whatsappWebUrl: string } {
  const introText = quoteCaptionText(q);
  const message = `${introText}\n\nView/download: ${APP_URL}/q/${q.id}`;
  const digits = delivery.normalizedPhone ?? q.contactPhone.replace(/[^0-9]/g, "");
  return {
    whatsappWebUrl: `https://api.whatsapp.com/send/?phone=${digits}&text=${encodeURIComponent(message)}&type=phone_number&app_absent=0`,
  };
}

/**
 * Flip the quote to "sent" and remember the PDF. Only the request that actually
 * turns a draft into "sent" schedules the 3-day follow-up (two quick sends must
 * not create two reminders). Deals are confirmed projects and never change stage
 * on a send.
 */
export async function markQuotationSent(args: {
  quotation: { id: string; number: string; accountContactId: string | null };
  pdfUrl: string;
  actorUserId: string;
  followUpConversationId: string | null;
  scheduleFollowUp?: boolean;
}): Promise<{ firstSend: boolean }> {
  const { quotation: q } = args;
  const firstSend = (await prisma.quotation.updateMany({ where: { id: q.id, status: "draft" }, data: { status: "sent" } })).count === 1;
  await prisma.quotation.update({
    where: { id: q.id },
    data: { pdfUrl: args.pdfUrl, status: "sent", sentAt: new Date() },
  });
  if (firstSend && args.scheduleFollowUp !== false) {
    await scheduleQuoteFollowUp({
      quotationNumber: q.number,
      accountContactId: q.accountContactId,
      conversationId: args.followUpConversationId,
      actorUserId: args.actorUserId,
    });
  }
  return { firstSend };
}

export type CloudSendResult =
  | { ok: true; captionText: string; captionMessageId: string | null; waMessageId: string }
  | { ok: false; message: string; code: string };

/**
 * Send the caption as a preceding text message, then the PDF as a document.
 * Splitting them fixes the "caption invisible" quirk WhatsApp has with
 * document-type captions — customers see the intro text clearly, then the file.
 */
export async function sendQuotationOverCloudApi(args: {
  quotation: { number: string; caption: string | null; grandTotal: { toString(): string } | number };
  sendTo: string;
  pdfUrl: string;
  fileName: string;
}): Promise<CloudSendResult> {
  const captionText = quoteCaptionText(args.quotation);
  let captionMessageId: string | null = null;
  let waMessageId = "";
  try {
    if (captionText) {
      const t = await sendText({ to: args.sendTo, body: captionText });
      captionMessageId = t.waMessageId;
    }
    const r = await sendMedia({
      to: args.sendTo,
      mediaType: "document",
      url: args.pdfUrl,
      // No inline caption — the intro text message already delivered it.
      filename: args.fileName,
    });
    waMessageId = r.waMessageId;
  } catch (err) {
    const e = describeMetaError(err);
    return { ok: false, message: e.message, code: e.code };
  }
  return { ok: true, captionText, captionMessageId, waMessageId };
}

/**
 * Mirror the caption text (if sent) + the PDF into the inbox thread so the
 * conversation shows both, matching what the customer sees.
 */
export async function mirrorQuotationToInbox(args: {
  conversationId: string;
  quotationNumber: string;
  captionText: string;
  captionMessageId: string | null;
  pdfUrl: string;
  fileName: string;
  waMessageId: string;
  actorUserId: string;
}): Promise<void> {
  if (args.captionMessageId) {
    await prisma.message
      .create({
        data: {
          conversationId: args.conversationId,
          direction: "outbound",
          type: "text",
          body: args.captionText,
          waMessageId: args.captionMessageId,
          status: "sent",
          sentByUserId: args.actorUserId,
        },
      })
      .catch(() => null);
  }
  await prisma.message
    .create({
      data: {
        conversationId: args.conversationId,
        direction: "outbound",
        type: "document",
        body: `📄 Quotation ${args.quotationNumber} sent`,
        mediaUrl: args.pdfUrl,
        mediaMimeType: "application/pdf",
        mediaFileName: args.fileName,
        waMessageId: args.waMessageId,
        status: "sent",
        sentByUserId: args.actorUserId,
      },
    })
    .catch(() => null);
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { lastOutboundAt: new Date() },
  });
}

// ── approval (AI Sales Agent) ───────────────────────────────────────────────

// The AI agent may only send a quote a person approved (Quotation.approvalState).
// When someone changes what the quote says, that approval no longer covers it.
const APPROVAL_CONTENT_FIELDS = ["customerName", "lengthFt", "widthFt", "lineItems", "notes", "validityDays", "sections"] as const;

/** Does this edit change what the customer would see on the quote? */
export function editsQuoteContent(patch: Partial<Record<(typeof APPROVAL_CONTENT_FIELDS)[number], unknown>>): boolean {
  return APPROVAL_CONTENT_FIELDS.some((k) => patch[k] !== undefined);
}

/** Columns that return a quote to "not approved". */
export const APPROVAL_RESET = { approvalState: "none", approvedByUserId: null, approvedAt: null } as const;
