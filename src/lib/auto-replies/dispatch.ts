// Auto-reply dispatcher. Called from the WhatsApp webhook after an
// inbound message is stored. Runs the rule matcher, honours per-contact
// cooldown, sends the response via sendText / sendMedia, logs the
// firing, and mirrors the outbound message into the conversation
// thread so the inbox shows the bot's reply.
//
// Silent-fail by design: any error here MUST NOT crash the webhook
// (Meta will retry the whole webhook payload otherwise). All send /
// DB / opt-out failures are caught + logged, never thrown up.

import { prisma } from "@/lib/prisma";
import { sendText, sendMedia } from "@/lib/whatsapp";
import { getSportMeta } from "@/lib/catalogue/sport-meta";
import { matchAutoReplyRule } from "./rules";

export type DispatchInput = {
  conversationId: string;
  contactPhone: string;
  inboundBody: string | null | undefined;
};

export type DispatchResult =
  | { fired: true; ruleId: string; waMessageId: string }
  | { fired: false; reason: string };

export async function dispatchAutoReply(input: DispatchInput): Promise<DispatchResult> {
  const { conversationId, contactPhone, inboundBody } = input;

  const rule = matchAutoReplyRule(inboundBody);
  if (!rule) return { fired: false, reason: "no_rule_match" };

  // Opt-out gate. Never auto-message a contact who's said STOP.
  try {
    const optOut = await prisma.optOut.findUnique({
      where: { phoneE164: contactPhone },
    });
    if (optOut) return { fired: false, reason: "opted_out" };
  } catch (err) {
    console.error("[auto-reply] opt-out check failed", err);
    return { fired: false, reason: "opt_out_check_error" };
  }

  // Cooldown check — has THIS rule fired for THIS contact within the
  // window? If yes, don't re-send.
  try {
    const cutoff = new Date(Date.now() - rule.cooldownHours * 3600 * 1000);
    const recent = await prisma.autoReplyLog.findFirst({
      where: {
        ruleId: rule.id,
        contactPhone,
        firedAt: { gte: cutoff },
      },
      select: { id: true },
    });
    if (recent) return { fired: false, reason: "cooldown_active" };
  } catch (err) {
    console.error("[auto-reply] cooldown check failed", err);
    // Failing open here is safer than failing closed — worst case we
    // send one extra message, not lose one.
  }

  const response = rule.buildResponse(inboundBody ?? "");

  let waMessageId: string;
  let mirrorBody: string;
  let mirrorType: "text" | "document" = "text";
  let mirrorMediaUrl: string | null = null;

  try {
    if (response.type === "text") {
      const r = await sendText({ to: contactPhone, body: response.body });
      waMessageId = r.waMessageId;
      mirrorBody = response.body;
    } else {
      // Catalogue response — look up the admin-uploaded PDF URL for
      // this sport. If missing, fall back to a text so the customer
      // isn't left hanging.
      const setting = await prisma.setting.findUnique({
        where: { key: `catalogue_${response.sport}_url` },
      });
      const pdfUrl = setting?.value ?? null;
      if (!pdfUrl) {
        const meta = getSportMeta(response.sport);
        const fallback = `Thanks for asking. Our ${meta?.label ?? response.sport} catalogue is being finalised. The team will share it with you shortly.`;
        const r = await sendText({ to: contactPhone, body: fallback });
        waMessageId = r.waMessageId;
        mirrorBody = fallback;
      } else {
        const meta = getSportMeta(response.sport);
        const caption = `Fitoverse ${meta?.label ?? response.sport} catalogue. Reply with your plot size and location for a tailored quote.`;
        const filename = `fitoverse-${response.sport}-catalogue.pdf`;
        // WhatsApp media captions render unreliably on some clients —
        // send the caption as text first, then the PDF. Same pattern
        // the send-catalogue endpoint uses.
        await sendText({ to: contactPhone, body: caption }).catch((err) =>
          console.error("[auto-reply] caption text failed", err)
        );
        const r = await sendMedia({
          to: contactPhone,
          mediaType: "document",
          url: pdfUrl,
          caption,
          filename,
        });
        waMessageId = r.waMessageId;
        mirrorBody = `[Catalogue] ${filename}`;
        mirrorType = "document";
        mirrorMediaUrl = pdfUrl;
      }
    }
  } catch (err) {
    console.error("[auto-reply] send failed", rule.id, err);
    return { fired: false, reason: "send_failed" };
  }

  await prisma.autoReplyLog
    .create({
      data: {
        ruleId: rule.id,
        conversationId,
        contactPhone,
        triggeredBy: (inboundBody ?? "").slice(0, 500),
        waMessageId,
      },
    })
    .catch((err) => console.error("[auto-reply] log write failed", err));

  await prisma.message
    .create({
      data: {
        conversationId,
        direction: "outbound",
        type: mirrorType,
        body: mirrorBody,
        mediaUrl: mirrorMediaUrl,
        waMessageId,
        status: "sent",
      },
    })
    .catch((err) =>
      console.error("[auto-reply] inbox mirror failed", err)
    );

  await prisma.conversation
    .update({
      where: { id: conversationId },
      data: { lastOutboundAt: new Date() },
    })
    .catch(() => null);

  return { fired: true, ruleId: rule.id, waMessageId };
}
