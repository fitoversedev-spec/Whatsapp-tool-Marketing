/**
 * What happens when a salesperson gets an AI lead — whichever way it came
 * (an admin approving the customer's or a salesperson's request, or assigning
 * directly):
 *
 *   1  the WhatsApp chat is assigned to them (their Inbox; every new customer
 *      message already pushes to the assigned rep)
 *   2  the CRM customer follows (same path as every other rep change)
 *   3  they get a handover push: what the customer needs, their number, a link
 *      to the full conversation
 *   4  the AI tells the customer who will contact them (when the 24 h window is
 *      open; otherwise get_ai_status tells the AI to do it in its next reply)
 *
 * After that the AI keeps answering product and technical questions, and each
 * AI reply is pushed to the salesperson too (conveyToSales).
 */
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { isMetaConfigured, sendText } from "@/lib/whatsapp";
import { reassignCustomerRep } from "@/lib/crm/assignRep";
import { logContactEvent } from "@/lib/crm/contactEvents";
import { introText } from "./logic";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export type Rep = { id: string; name: string; phone: string | null; pushEnabled: boolean };

export function displayPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : null;
}

function requirementsLine(fields: string | null | undefined): string {
  try {
    const f = JSON.parse(fields ?? "{}") as Record<string, unknown>;
    const pick = ["agent.sport", "agent.city", "agent.budgetInr", "agent.timeline"]
      .map((k) => f[k])
      .filter((v) => v !== undefined && v !== null && v !== "");
    return pick.map(String).join(" · ");
  } catch {
    return "";
  }
}

/** Tell the customer who their salesperson is. True when sent. Never throws. */
export async function introduceSalesperson(handoffId: string): Promise<boolean> {
  try {
    const h = await prisma.aiHumanHandoff.findUnique({
      where: { id: handoffId },
      select: { id: true, conversationId: true, assignedToUserId: true, introducedAt: true, status: true },
    });
    if (!h || h.status !== "APPROVED" || h.introducedAt || !h.assignedToUserId) return false;
    const [convo, rep, agent] = await Promise.all([
      prisma.conversation.findUnique({
        where: { id: h.conversationId },
        select: { contactPhone: true, contactName: true, lastInboundAt: true },
      }),
      prisma.user.findUnique({ where: { id: h.assignedToUserId }, select: { name: true, phone: true } }),
      prisma.user.findFirst({ where: { role: "ai_agent" }, select: { id: true } }),
    ]);
    if (!convo || !rep || !agent) return false;
    // Free text needs the customer's 24 h window; outside it the AI introduces them on its next reply.
    if (!convo.lastInboundAt || Date.now() - convo.lastInboundAt.getTime() > WINDOW_MS) return false;
    const optedOut = await prisma.optOut.findFirst({ where: { phoneE164: convo.contactPhone }, select: { phoneE164: true } });
    if (optedOut || !(await isMetaConfigured())) return false;

    const text = introText(convo.contactName, { name: rep.name, phone: displayPhone(rep.phone) });
    const sent = await sendText({ to: convo.contactPhone, body: text });
    await prisma.message.create({
      data: {
        conversationId: h.conversationId,
        direction: "outbound",
        type: "text",
        body: text,
        waMessageId: sent.waMessageId || null,
        status: "sent",
        sentByUserId: agent.id,
      },
    });
    await prisma.conversation.update({ where: { id: h.conversationId }, data: { lastOutboundAt: new Date() }, select: { id: true } });
    await prisma.aiHumanHandoff.update({ where: { id: h.id }, data: { introducedAt: new Date() }, select: { id: true } });
    return true;
  } catch (err) {
    console.error("[handoff] introduction not sent", (err as Error)?.name);
    return false;
  }
}

/** Steps 1–4 above, for a handoff row that was just set to APPROVED for `rep`. */
export async function applyAssignment(args: {
  handoff: { id: string; conversationId: string; accountContactId: string | null; reason: string; summary: string };
  rep: Rep;
  actorUserId: string;
  note: string | null;
}): Promise<void> {
  const { handoff, rep } = args;
  await prisma.conversation.update({
    where: { id: handoff.conversationId },
    data: { assignedToUserId: rep.id },
    select: { id: true },
  });

  let needs = "";
  if (handoff.accountContactId) {
    const lead = await prisma.accountContact.findUnique({
      where: { id: handoff.accountContactId },
      select: { accountId: true, fields: true },
    });
    if (lead) {
      await reassignCustomerRep({ accountId: lead.accountId, toUserId: rep.id, actorUserId: args.actorUserId });
      await logContactEvent({
        contactId: handoff.accountContactId,
        actorUserId: args.actorUserId,
        kind: "escalated",
        summary: `AI lead assigned to ${rep.name}`,
        detail: args.note,
        refId: handoff.id,
      });
      needs = requirementsLine(lead.fields);
    }
  }
  await prisma.aiHotLead.updateMany({
    where: { conversationId: handoff.conversationId },
    data: { claimedByUserId: rep.id, claimedAt: new Date() },
  });

  // Handover: who, what they need, the number to call, the full chat one tap away.
  if (rep.pushEnabled) {
    try {
      const convo = await prisma.conversation.findUnique({
        where: { id: handoff.conversationId },
        select: { contactName: true, contactPhone: true },
      });
      const phone = displayPhone(convo?.contactPhone) ?? "";
      const firstSummaryLine = handoff.summary.split("\n").filter(Boolean).slice(0, 2).join(" · ");
      await sendPushToUser(rep.id, {
        title: `New lead for you: ${convo?.contactName || phone}`,
        body: [phone, needs || firstSummaryLine || handoff.reason].filter(Boolean).join(" — ").slice(0, 160),
        url: `/ai-chats?c=${handoff.conversationId}`,
        tag: `ai-lead-${handoff.conversationId}`,
      });
    } catch {
      // Best effort: the lead is on their AI agent chats page and in their Inbox.
    }
  }

  await introduceSalesperson(handoff.id);
}

/**
 * After the AI replies in a chat a salesperson owns: push the reply to them so
 * they follow the conversation (customer messages already push to the assigned
 * rep). Never throws.
 */
export async function conveyToSales(conversationId: string, text: string): Promise<void> {
  try {
    const h = await prisma.aiHumanHandoff.findFirst({
      where: { conversationId, status: "APPROVED" },
      orderBy: { requestedAt: "desc" },
      select: { assignedToUserId: true },
    });
    if (!h?.assignedToUserId) return;
    const rep = await prisma.user.findUnique({ where: { id: h.assignedToUserId }, select: { pushEnabled: true } });
    if (!rep?.pushEnabled) return;
    const convo = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { contactName: true, contactPhone: true } });
    await sendPushToUser(h.assignedToUserId, {
      title: `AI → ${convo?.contactName || displayPhone(convo?.contactPhone) || "customer"}`,
      body: text.slice(0, 160),
      url: `/ai-chats?c=${conversationId}`,
      tag: `ai-reply-${conversationId}`,
    });
  } catch {
    // Best effort.
  }
}
