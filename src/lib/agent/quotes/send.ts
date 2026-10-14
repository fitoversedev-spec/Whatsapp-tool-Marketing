import { prisma } from "@/lib/prisma";
import { ensureQuotationPdf, quotationFileName } from "@/lib/quotation/pdf-cache";
import {
  isRecentlySent,
  markQuotationSent,
  mirrorQuotationToInbox,
  sendQuotationOverCloudApi,
} from "@/lib/quotation/service";
import { isMetaConfigured } from "@/lib/whatsapp";
import { resolveWhatsAppDelivery } from "@/lib/whatsapp-delivery";
import { AgentHttpError } from "../errors";
import { phoneCandidates, refusal } from "../messaging/access";
import type { QuotePathInput } from "../schemas/quotes";
import type { AgentHandler, AgentHandlerResult } from "../withAgent";
import { assertPriceable, parseStoredLines, SENDABLE_STATUSES, totalsMatchLines } from "./logic";
import { loadQuote } from "./store";

/**
 * send_quote: WhatsApp an APPROVED quotation to the customer.
 *
 * Order of checks (most absolute first): approved by a person (else 403
 * quote_not_approved) -> still sendable -> numbers consistent -> has a phone ->
 * not opted out -> not sent in the last 10 minutes -> the 24 h window is open
 * (else 409 handoff_required, nothing sent) -> send -> record.
 *
 * The recipient is ALWAYS the quotation's own phone, the caption is the saved
 * one (or the standard one-liner), and the file is the saved PDF of exactly
 * what was approved. Nothing the caller types reaches the customer.
 */

const NOT_APPROVED =
  "This quotation has not been approved by a person, so the AI agent cannot send it. Call submit_quote_for_approval and wait until a person approves it.";

export const sendQuote: AgentHandler<QuotePathInput> = async ({ ctx, input }) => {
  const q = await loadQuote(input.quotationId);

  if (q.approvalState !== "approved") return refusal(ctx, "quote_not_approved", NOT_APPROVED, 403, [q.id]);

  if (!(SENDABLE_STATUSES as readonly string[]).includes(q.status)) {
    return refusal(ctx, "not_sendable", `A ${q.status} quotation cannot be sent. Revise it to make a new draft.`, 409, [q.id]);
  }

  // The approved numbers must still be the saved numbers.
  const lines = parseStoredLines(q.lineItems);
  if (!totalsMatchLines({ lines, subtotal: Number(q.subtotal), gstAmount: Number(q.gstAmount), grandTotal: Number(q.grandTotal) })) {
    return refusal(ctx, "quote_inconsistent", "The saved totals do not match the saved lines. Ask a person to look at this quotation.", 409, [q.id]);
  }
  try {
    assertPriceable(lines);
  } catch (err) {
    if (err instanceof AgentHttpError) return refusal(ctx, "quote_inconsistent", err.message, 409, [q.id]);
    throw err;
  }

  if (!q.contactPhone) {
    return refusal(ctx, "no_contact_phone", "This quotation has no customer phone number, so it cannot be sent by WhatsApp.", 422, [q.id]);
  }

  const optedOut = await prisma.optOut.findFirst({
    where: { phoneE164: { in: phoneCandidates(q.contactPhone) } },
    select: { phoneE164: true },
  });
  if (optedOut) {
    return refusal(ctx, "opted_out", "This contact has opted out. The AI agent never messages opted-out contacts.", 403, [q.id]);
  }

  // The same resend guard the staff screen uses: no second send within 10 minutes.
  if (isRecentlySent(q.sentAt)) {
    return refusal(ctx, "recently_sent", `This quotation was already sent at ${q.sentAt!.toISOString()}. Wait before sending it again.`, 409, [q.id]);
  }

  // An open 24 h session sends directly; otherwise a person must send it from their own WhatsApp.
  const delivery = await resolveWhatsAppDelivery({ contactPhone: q.contactPhone, linkedConversationId: q.conversationId });
  if (delivery.mode !== "cloud-api") {
    const result: AgentHandlerResult = refusal(
      ctx,
      "handoff_required",
      "The customer's 24-hour WhatsApp window is closed, so Fitoverse cannot send the quotation directly. Nothing was sent. Hand this lead to a person (escalate_lead) to send it.",
      409,
      [q.id],
    );
    (result.body as Record<string, unknown>).handoffRequired = true;
    (result.body as Record<string, unknown>).sent = false;
    return result;
  }

  if (!(await isMetaConfigured())) throw new AgentHttpError("internal", "WhatsApp sending is not configured.", 503);

  let pdfUrl: string;
  try {
    pdfUrl = (await ensureQuotationPdf(q)).url;
  } catch (err) {
    console.error("[agent] quote pdf failed", { error: (err as Error)?.name });
    throw new AgentHttpError("internal", "Could not render the quotation PDF.", 502);
  }

  const fileName = quotationFileName(q);
  const sendTo = delivery.normalizedPhone ?? q.contactPhone;
  const sent = await sendQuotationOverCloudApi({ quotation: q, sendTo, pdfUrl, fileName });
  if (!sent.ok) {
    if (sent.code === "timeout") {
      return refusal(
        ctx,
        "delivery_unknown",
        "WhatsApp did not answer in time; the quotation may or may not have been delivered. Check the conversation before sending again.",
        409,
        [q.id],
      );
    }
    throw new AgentHttpError("internal", `WhatsApp rejected the quotation (${sent.code}): ${sent.message}`.slice(0, 300), 502);
  }

  // From here the customer HAS the quotation: a bookkeeping failure must not make the caller retry the send.
  let mirrored = false;
  try {
    const owner = q.accountContactId
      ? await prisma.accountContact.findUnique({ where: { id: q.accountContactId }, select: { account: { select: { ownerUserId: true } } } })
      : null;
    await markQuotationSent({
      quotation: q,
      pdfUrl,
      actorUserId: ctx.userId,
      followUpConversationId: q.conversationId ?? delivery.conversationId ?? null,
      // The reminder goes to the customer's rep; with no rep it would land on the AI's own account, where nobody reads it.
      scheduleFollowUp: !!owner?.account.ownerUserId,
    });
    if (delivery.conversationId) {
      await mirrorQuotationToInbox({
        conversationId: delivery.conversationId,
        quotationNumber: q.number,
        captionText: sent.captionText,
        captionMessageId: sent.captionMessageId,
        pdfUrl,
        fileName,
        waMessageId: sent.waMessageId,
        actorUserId: ctx.userId,
      });
      mirrored = true;
    }
  } catch (err) {
    console.error("[agent] quotation sent but not recorded", { quotationId: q.id, error: (err as Error)?.name });
  }

  return {
    body: { sent: true, quotationId: q.id, number: q.number, waMessageId: sent.waMessageId || null, mirrored },
    recordIds: [q.id],
    fieldsChanged: ["status", "sentAt"],
  };
};
