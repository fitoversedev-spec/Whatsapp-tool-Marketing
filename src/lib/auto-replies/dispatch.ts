// Auto-reply dispatcher. Called from the WhatsApp webhook after an
// inbound message is stored. Runs the rule matcher, honours per-contact
// cooldown, sends the response via sendText, logs the firing, and
// mirrors the outbound message into the conversation thread so the
// inbox shows the bot's reply.
//
// Silent-fail by design: any error here MUST NOT crash the webhook
// (Meta will retry the whole webhook payload otherwise). All send /
// DB / opt-out failures are caught + logged, never thrown up.

import { prisma } from "@/lib/prisma";
import { sendText } from "@/lib/whatsapp";
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

  // Send + log + mirror. Wrap each step so partial failures don't
  // break the whole pipeline.
  let waMessageId: string;
  try {
    const r = await sendText({ to: contactPhone, body: rule.responseBody });
    waMessageId = r.waMessageId;
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
        type: "text",
        body: rule.responseBody,
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
