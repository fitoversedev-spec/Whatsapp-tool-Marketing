/**
 * send_design: send the pictures that already exist on a court design to the
 * customer on WhatsApp.
 *
 *  - The phone is the one on the design's own conversation or contact. Nothing in
 *    the request names a number, and a design whose saved phone disagrees with
 *    its link is refused rather than guessed at.
 *  - Opted-out contacts are refused (opted_out); outside the 24 h window it is
 *    refused (window_closed). The human screen can fall back to a WhatsApp Web
 *    link; the AI cannot, so it stops.
 *  - Only formats already on the record are sent (never generated).
 *  - What was sent is saved into the inbox thread with the AI as sender.
 * The pictures, order, caption and inbox record come from src/lib/court-image/send.ts,
 * the same code as POST /api/court-images/[id]/send.
 */
import type { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { describeMetaError, isMetaConfigured, sendMedia, sendText } from "@/lib/whatsapp";
import {
  buildDesignSendItems,
  designCaption,
  designMirrorMedia,
  type DesignFormat,
  type DesignSendItem,
} from "@/lib/court-image/send";
import type { AgentContext } from "../context";
import { AgentHttpError } from "../errors";
import { loadEligibility, refusal } from "../messaging/access";
import { DEDUPE_WINDOW_MS } from "../messaging/dedupe";
import { chargeConversationLimit } from "../messaging/limits";
import { requireId } from "../read/shared";
import type { sendDesignBodySchema } from "../schemas/documents";
import type { AgentHandler, AgentHandlerResult } from "../withAgent";

const OPTED_OUT_MESSAGE = "This contact has opted out. The AI agent never messages opted-out contacts.";

type Convo = { id: string; contactPhone: string; lastInboundAt: Date | null };
type DesignToSend = {
  id: string;
  number: string;
  customerName: string;
  caption: string | null;
  imageUrl: string | null;
  image2dUrl: string | null;
  image3dUrl: string | null;
  video3dUrl: string | null;
  conversationId: string | null;
  accountContactId: string | null;
  contactPhone: string | null;
};

const CONVO_SELECT = { id: true, contactPhone: true, lastInboundAt: true } as const;

type Target =
  | { ok: true; phone: string; convo: Convo | null }
  | { ok: false; code: "no_customer_link" | "no_phone" | "phone_mismatch"; message: string };

/** Where the design goes: the number on its own conversation, else on its own contact. */
export async function resolveSendTarget(design: DesignToSend): Promise<Target> {
  let convo: Convo | null = null;
  let rawPhone: string | null = null;
  if (design.conversationId) {
    convo = await prisma.conversation.findUnique({ where: { id: design.conversationId }, select: CONVO_SELECT });
    rawPhone = convo?.contactPhone ?? null;
  }
  if (!convo && design.accountContactId) {
    const ac = await prisma.accountContact.findUnique({
      where: { id: design.accountContactId },
      select: { phone: true, deletedAt: true },
    });
    rawPhone = ac && !ac.deletedAt ? ac.phone : null;
  }
  if (!design.conversationId && !design.accountContactId) {
    return {
      ok: false,
      code: "no_customer_link",
      message: "This design is not linked to a customer conversation or contact, so there is nowhere safe to send it.",
    };
  }
  if (!rawPhone) return { ok: false, code: "no_phone", message: "The customer linked to this design has no phone number." };
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, code: "no_phone", message: "The customer linked to this design has no usable phone number." };
  if (design.contactPhone && normalizePhone(design.contactPhone) !== phone) {
    return {
      ok: false,
      code: "phone_mismatch",
      message: "The phone saved on this design is not the linked customer's number. A team member must check it.",
    };
  }
  if (!convo) convo = await prisma.conversation.findUnique({ where: { contactPhone: phone }, select: CONVO_SELECT });
  return { ok: true, phone, convo };
}

type Sent = { format: string; waMessageId: string; url: string | null; type: "text" | "image" | "video" };

/** Save what went out so the inbox thread shows it. A failed save never fails the request. */
async function mirrorSent(ctx: AgentContext, design: DesignToSend, conversationId: string, caption: string, sent: Sent[]) {
  let saved = 0;
  for (const s of sent) {
    const fields =
      s.type === "text"
        ? { type: "text", body: caption }
        : designMirrorMedia(design, { format: s.format, url: s.url, isVideo: s.type === "video" });
    try {
      await prisma.message.create({
        data: {
          conversationId,
          direction: "outbound",
          ...fields,
          waMessageId: s.waMessageId || null,
          status: "sent",
          sentByUserId: ctx.userId,
        },
      });
      saved += 1;
    } catch (error) {
      console.error("[agent] design message sent but not saved", { conversationId, error: (error as Error)?.name });
    }
  }
  try {
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastOutboundAt: new Date() }, select: { id: true } });
  } catch (error) {
    console.error("[agent] conversation not updated after design send", { conversationId, error: (error as Error)?.name });
  }
  return saved;
}

export const sendDesign: AgentHandler<z.infer<typeof sendDesignBodySchema>> = async ({ ctx, input, params }) => {
  const id = requireId(params.id, "Design");
  const design = (await prisma.courtImage.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      customerName: true,
      caption: true,
      imageUrl: true,
      image2dUrl: true,
      image3dUrl: true,
      video3dUrl: true,
      conversationId: true,
      accountContactId: true,
      contactPhone: true,
    },
  })) as DesignToSend | null;
  if (!design) throw new AgentHttpError("not_found", "Design not found.");

  const target = await resolveSendTarget(design);
  if (!target.ok) return refusal(ctx, target.code, target.message, 422, [id]);

  const now = Date.now();
  const elig = await loadEligibility({ contactPhone: target.phone, lastInboundAt: target.convo?.lastInboundAt ?? null }, now);
  if (elig.optedOut) return refusal(ctx, "opted_out", OPTED_OUT_MESSAGE, 403, [id]);
  if (!elig.windowOpen || !target.convo) {
    return refusal(
      ctx,
      "window_closed",
      "The 24-hour window is closed, and a design can only be sent inside it. A team member can send it from the Court Designer instead.",
      409,
      [id],
    );
  }
  const convo = target.convo;

  const built = buildDesignSendItems(design, input.formats);
  if (!built.ok) {
    return refusal(ctx, "format_missing", `This design has no ${built.missing} picture yet; the AI cannot create one.`, 422, [id]);
  }

  // The same picture of the same design, to the same chat, within 10 minutes is a repeat.
  const recent = await prisma.message.findMany({
    where: {
      conversationId: convo.id,
      direction: "outbound",
      createdAt: { gte: new Date(now - DEDUPE_WINDOW_MS) },
      mediaFileName: { startsWith: `${design.number}-` },
    },
    select: { mediaFileName: true },
    take: 20,
  });
  const already = new Set(recent.map((m) => m.mediaFileName));
  const key = (i: DesignSendItem) => `${design.number}-${i.format}.${i.fileExt}`;
  const items = built.items.filter((i) => !already.has(key(i)));
  const skipped = built.items.filter((i) => already.has(key(i))).map((i) => i.format);
  if (items.length === 0) {
    return {
      body: { sent: false, duplicate: true, formatsSent: [], skippedDuplicateFormats: skipped, mirrored: 0 },
      recordIds: [id, convo.id],
    };
  }

  const charge = await chargeConversationLimit(ctx.identityId, convo.id, now);
  if (!charge.allowed) {
    return refusal(
      ctx,
      "rate_limited",
      `At most ${charge.limit} messages per conversation per hour. Try again in ${charge.retryAfterSec} seconds.`,
      429,
      [id],
    );
  }

  if (!(await isMetaConfigured())) throw new AgentHttpError("internal", "WhatsApp sending is not configured.", 503);

  const caption = designCaption(design);
  const sent: Sent[] = [];
  try {
    const t = await sendText({ to: target.phone, body: caption });
    sent.push({ format: "caption", waMessageId: t.waMessageId, url: null, type: "text" });
  } catch (err) {
    const e = describeMetaError(err);
    if (e.code === "timeout") {
      return refusal(
        ctx,
        "delivery_unknown",
        "WhatsApp did not answer in time; the message may or may not have been delivered. Check get_messages before sending again.",
        409,
        [id, convo.id],
      );
    }
    throw new AgentHttpError("internal", `WhatsApp rejected the message (${e.code}): ${e.message}`.slice(0, 300), 502);
  }

  for (const item of items) {
    try {
      const r = await sendMedia({ to: target.phone, mediaType: item.mediaType, url: item.url });
      sent.push({ format: item.format, waMessageId: r.waMessageId, url: item.url, type: item.mediaType });
    } catch (err) {
      const e = describeMetaError(err);
      await mirrorSent(ctx, design, convo.id, caption, sent);
      const delivered = sent.filter((s) => s.type !== "text").map((s) => s.format);
      // Part of it is with the customer; a retry would send it twice, so this is a final answer, not a failure to retry.
      return refusal(
        ctx,
        "delivery_incomplete",
        `Sending stopped at the ${item.format} picture (${e.code}). Already delivered: ${delivered.length ? delivered.join(", ") : "only the intro text"}. Check get_messages before sending again.`.slice(0, 400),
        409,
        [id, convo.id],
      );
    }
  }

  try {
    await prisma.courtImage.update({ where: { id }, data: { status: "sent", sentAt: new Date() }, select: { id: true } });
  } catch (error) {
    console.error("[agent] design sent but not marked sent", { designId: id, error: (error as Error)?.name });
  }
  const mirrored = await mirrorSent(ctx, design, convo.id, caption, sent);

  const body = {
    sent: true,
    duplicate: false,
    formatsSent: items.map((i) => i.format) as DesignFormat[],
    skippedDuplicateFormats: skipped,
    mirrored,
  };
  const result: AgentHandlerResult = { body, recordIds: [id, convo.id], fieldsChanged: ["status", "sentAt", "message"] };
  return result;
};
