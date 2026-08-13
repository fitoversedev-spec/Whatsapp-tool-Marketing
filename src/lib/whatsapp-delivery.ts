// Decide HOW a quotation / court-design / catalogue / invoice should reach a
// customer over WhatsApp:
//
//   "cloud-api"    → the customer has an OPEN 24-hour customer-service session
//                    (they messaged our marketing number within the last 24h),
//                    so we send directly from the marketing number as a real
//                    chat — text + the actual FILE (document/image/video).
//
//   "whatsapp-web" → no open session (a cold CRM lead who never messaged us, or
//                    an inbound customer whose 24h window has lapsed). Meta will
//                    NOT accept a free-form file send here, so we hand off to a
//                    WhatsApp Web / click-to-chat link that a human sends from
//                    their own phone. Click-to-chat can only pre-fill text, so
//                    those messages carry a LINK to the file, not the file.
//
// The session is located by NORMALISED phone number (not just an explicitly
// linked conversation), so a direct send still happens when the item was built
// from the CRM / Quotations list rather than from inside the Inbox thread — as
// long as that customer has an open chat with us.

import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";

// Meta's customer-service window: free-form (non-template) messages may only be
// sent within 24h of the customer's last inbound message. Same constant the
// Inbox composer enforces (see api/conversations/[id]/messages/route.ts).
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type WhatsAppDeliveryMode = "cloud-api" | "whatsapp-web";

export type WhatsAppDelivery = {
  mode: WhatsAppDeliveryMode;
  // The customer's conversation thread to mirror outbound messages into, if one
  // exists. Prefers an explicitly-linked conversation, else the one found by
  // phone number. Null when the customer has never messaged us.
  conversationId: string | null;
  // The customer's phone in Meta format (E.164 without '+'), or null if the
  // input couldn't be normalised. Use this — not the raw contactPhone — as the
  // `to` for Cloud API sends: when mode is "cloud-api" it is always non-null
  // (an open session can only be found via a valid normalised number), so the
  // number handed to Meta is clean regardless of how it was typed.
  normalizedPhone: string | null;
};

export async function resolveWhatsAppDelivery(args: {
  contactPhone: string;
  linkedConversationId?: string | null;
}): Promise<WhatsAppDelivery> {
  const normalized = normalizePhone(args.contactPhone);

  // Conversation.contactPhone is unique and stored in the same Meta-format
  // (E.164 without '+') that normalizePhone() produces, so this is an exact
  // match on the customer's single conversation row.
  const convo = normalized
    ? await prisma.conversation.findUnique({
        where: { contactPhone: normalized },
        select: { id: true, lastInboundAt: true },
      })
    : null;

  const active =
    !!convo?.lastInboundAt &&
    Date.now() - convo.lastInboundAt.getTime() < SESSION_WINDOW_MS;

  return {
    mode: active ? "cloud-api" : "whatsapp-web",
    // In cloud-api mode, mirror into the PHONE-MATCHED conversation — it
    // provably belongs to the number we actually send to (normalizedPhone), so
    // an edited/divergent recipient phone can't land the mirror in some other
    // customer's linked thread. Only fall back to a caller-supplied linked
    // thread when there's no phone match (i.e. the whatsapp-web path).
    conversationId: active
      ? (convo?.id ?? args.linkedConversationId ?? null)
      : (args.linkedConversationId ?? convo?.id ?? null),
    normalizedPhone: normalized,
  };
}
