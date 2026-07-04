// After-hours gate. Runs at the top of the WhatsApp webhook, BEFORE
// the chatbot flow dispatcher. When the current time is outside our
// business hours (9am–8pm IST) AND the inbound is a fresh conversation
// (no active flow), we send one polite acknowledgement and stop —
// starting a multi-turn interactive menu at 3am is worse UX than a
// simple "team is offline, we'll get back to you tomorrow".
//
// Mid-flow messages (button taps, or free text with an active flow row)
// are NOT gated — we don't want to interrupt a customer who's already
// mid-conversation, e.g. started the flow at 7:55pm and taps a button
// at 8:15pm.
//
// Cooldown of 12h per contact ensures a customer messaging at 3am, 4am,
// 5am doesn't receive three identical acknowledgements. Silent-fail on
// every branch — this must NEVER crash the webhook (Meta will retry the
// whole payload on any 5xx).

import { prisma } from "@/lib/prisma";
import { sendText } from "@/lib/whatsapp";

// Business hours: 9am–8pm IST. Outside this window, the gate fires.
export const BUSINESS_HOUR_START = 9;
export const BUSINESS_HOUR_END = 20;

const RULE_ID = "after_hours";
const COOLDOWN_HOURS = 12;

const AFTER_HOURS_BODY =
  "Thanks for reaching out to Fitoverse. Our team is offline right now — we work Monday to Saturday, 9am to 8pm IST. We've noted your message and will get back to you first thing in the morning.";

// IST hour in 24h. Compute from UTC + 5:30 rather than depending on
// server locale (Vercel runs in UTC).
export function istHour(now: Date): number {
  const utcMs = now.getTime();
  const istMs = utcMs + (5 * 60 + 30) * 60 * 1000;
  return new Date(istMs).getUTCHours();
}

export function isAfterHoursIST(now: Date = new Date()): boolean {
  const h = istHour(now);
  return h < BUSINESS_HOUR_START || h >= BUSINESS_HOUR_END;
}

export type AfterHoursGateInput = {
  conversationId: string;
  contactPhone: string;
  // True when the inbound is an interactive.button_reply or
  // interactive.list_reply — i.e. the customer tapped something we
  // sent them earlier. Never gate these; they always mean "continue
  // the flow that's already in progress".
  hasInteractiveReply: boolean;
  now?: Date;
};

// Returns true if the gate handled the message and the caller should
// short-circuit the rest of the webhook. Returns false if the caller
// should continue with normal chatbot / auto-reply dispatch.
export async function dispatchAfterHoursGate(
  input: AfterHoursGateInput,
): Promise<boolean> {
  const { conversationId, contactPhone, hasInteractiveReply } = input;
  const now = input.now ?? new Date();

  // Not our concern — customer is tapping a button in an existing flow.
  if (hasInteractiveReply) return false;

  // Not our concern — we're inside business hours.
  if (!isAfterHoursIST(now)) return false;

  // Opt-out gate. Never message someone who's said STOP — but still
  // short-circuit so we don't then run the chatbot on them either.
  try {
    const optOut = await prisma.optOut.findUnique({
      where: { phoneE164: contactPhone },
    });
    if (optOut) return true;
  } catch (err) {
    console.error("[after-hours] opt-out check failed", err);
    return false;
  }

  // Active-flow check. If the customer started a flow earlier (e.g.
  // during business hours) and is still mid-conversation, let it run.
  // Interrupting a half-collected lead with "we're offline" is worse
  // than letting them finish and having the team read the lead later.
  try {
    const activeFlow = await prisma.conversationFlow.findFirst({
      where: { conversationId, endedAt: null },
      select: { id: true },
    });
    if (activeFlow) return false;
  } catch (err) {
    console.error("[after-hours] flow check failed", err);
    // Fail open — let the chatbot decide rather than blocking silently.
    return false;
  }

  // Cooldown: has the ack already fired for this contact recently?
  try {
    const cutoff = new Date(now.getTime() - COOLDOWN_HOURS * 3600 * 1000);
    const recent = await prisma.autoReplyLog.findFirst({
      where: {
        ruleId: RULE_ID,
        contactPhone,
        firedAt: { gte: cutoff },
      },
      select: { id: true },
    });
    if (recent) {
      // Already acknowledged — stay silent, but still short-circuit so
      // we don't start a chatbot menu at 3am on the follow-up message.
      return true;
    }
  } catch (err) {
    console.error("[after-hours] cooldown check failed", err);
    // Fail open — better one extra ack than none.
  }

  // Send the acknowledgement.
  let waMessageId: string;
  try {
    const r = await sendText({ to: contactPhone, body: AFTER_HOURS_BODY });
    waMessageId = r.waMessageId;
  } catch (err) {
    console.error("[after-hours] send failed", err);
    // Send failed — don't short-circuit; give the chatbot a chance.
    return false;
  }

  // Log the firing so the cooldown holds on the next inbound.
  await prisma.autoReplyLog
    .create({
      data: {
        ruleId: RULE_ID,
        conversationId,
        contactPhone,
        triggeredBy: "[after-hours-gate]",
        waMessageId,
      },
    })
    .catch((err) => console.error("[after-hours] log write failed", err));

  // Mirror to the message thread so sales sees it in the inbox.
  await prisma.message
    .create({
      data: {
        conversationId,
        direction: "outbound",
        type: "text",
        body: AFTER_HOURS_BODY,
        waMessageId,
        status: "sent",
      },
    })
    .catch((err) => console.error("[after-hours] inbox mirror failed", err));

  await prisma.conversation
    .update({
      where: { id: conversationId },
      data: { lastOutboundAt: new Date() },
    })
    .catch(() => null);

  return true;
}
