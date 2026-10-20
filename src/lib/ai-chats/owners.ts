/**
 * No duplicate ownership of a customer.
 *
 * A Meta lead can get a salesperson before the AI ever hears back from the
 * customer — on the Meta leads page, in the CRM, or in the Inbox. Every AI
 * path asks findExistingOwner() first, so that person keeps the customer:
 *
 *   start_lead_conversation   the AI does not send its welcome to someone a
 *                             salesperson already owns (no double contact)
 *   AI reply / ai-status /    the chat is linked to that owner (adoptExistingOwner):
 *   handoff / hot sweep       an APPROVED EXISTING_OWNER handoff, so it shows as
 *                             theirs, nobody else can request it, alerts and every
 *                             message go to them, and the AI introduces them
 *
 * Phone numbers are matched in every stored spelling, so repeat form fills and
 * the WhatsApp chat of the same person resolve to one owner.
 */
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { sendPushToUser } from "@/lib/push";
import { reassignCustomerRep } from "@/lib/crm/assignRep";
import { logContactEvent } from "@/lib/crm/contactEvents";
import { introduceSalesperson } from "@/lib/agent/handoffs/assign";

export type OwnerSource = "chat" | "crm" | "ad_lead";
export type ExistingOwner = { userId: string; name: string; source: OwnerSource; leadId: string | null };

export const OWNER_SOURCE_LABEL: Record<OwnerSource, string> = {
  chat: "the WhatsApp Inbox",
  crm: "the CRM",
  ad_lead: "Meta leads",
};

/** Every spelling a phone may be stored under: as given, digits-only E.164, and with "+". */
export function phoneVariants(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const n = normalizePhone(raw);
  return [...new Set([raw, n, n ? `+${n}` : null].filter((p): p is string => !!p))];
}

/**
 * The salesperson who already owns this phone, if any. Priority: the WhatsApp
 * chat's assignee, then the CRM customer's rep, then the newest Meta lead
 * assignment. Only active people count; the AI's own user never does.
 */
export async function findExistingOwner(phone: string): Promise<ExistingOwner | null> {
  const phones = phoneVariants(phone);
  if (!phones.length) return null;

  const [convo, contact, crmDirect, metaLead] = await Promise.all([
    prisma.conversation.findFirst({ where: { contactPhone: { in: phones } }, select: { assignedToUserId: true } }),
    prisma.contact.findFirst({
      where: { phone: { in: phones }, accountContactId: { not: null } },
      select: { accountContactId: true, accountContact: { select: { deletedAt: true, account: { select: { ownerUserId: true } } } } },
    }),
    prisma.accountContact.findFirst({
      where: { phone: { in: phones }, deletedAt: null, account: { ownerUserId: { not: null }, deletedAt: null } },
      orderBy: { createdAt: "desc" },
      select: { id: true, account: { select: { ownerUserId: true } } },
    }),
    prisma.metaLead.findFirst({
      where: { OR: [{ normalizedPhone: { in: phones } }, { phone: { in: phones } }], assignedToUserId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { assignedToUserId: true, accountContactId: true },
    }),
  ]);

  const linkedLead = contact?.accountContact && !contact.accountContact.deletedAt ? contact : null;
  const leadId = linkedLead?.accountContactId ?? crmDirect?.id ?? metaLead?.accountContactId ?? null;
  const candidates: [string | null | undefined, OwnerSource][] = [
    [convo?.assignedToUserId, "chat"],
    [linkedLead?.accountContact?.account.ownerUserId ?? crmDirect?.account.ownerUserId, "crm"],
    [metaLead?.assignedToUserId, "ad_lead"],
  ];
  for (const [userId, source] of candidates) {
    if (!userId) continue;
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true, role: { not: "ai_agent" } },
      select: { id: true, name: true },
    });
    if (user) return { userId: user.id, name: user.name, source, leadId };
  }
  return null;
}

/**
 * Link an AI chat to the salesperson who already owns the customer. Only for
 * chats that never had a handoff (so a released or declined lead is not
 * re-linked). Returns the owner when it linked. Never throws.
 */
export async function adoptExistingOwner(conversationId: string): Promise<ExistingOwner | null> {
  try {
    const any = await prisma.aiHumanHandoff.findFirst({ where: { conversationId }, select: { id: true } });
    if (any) return null;
    const convo = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, contactPhone: true, contactName: true, assignedToUserId: true },
    });
    if (!convo) return null;
    const owner = await findExistingOwner(convo.contactPhone);
    if (!owner) return null;

    const [identity, rep] = await Promise.all([
      prisma.agentIdentity.findFirst({ select: { id: true } }),
      prisma.user.findUnique({ where: { id: owner.userId }, select: { pushEnabled: true } }),
    ]);
    const now = new Date();
    const handoff = await prisma.aiHumanHandoff.create({
      data: {
        conversationId,
        accountContactId: owner.leadId,
        identityId: identity?.id ?? "existing-owner",
        kind: "EXISTING_OWNER",
        reason: `Already assigned to ${owner.name} in ${OWNER_SOURCE_LABEL[owner.source]}`,
        summary: "",
        status: "APPROVED",
        assignedToUserId: owner.userId,
        decidedAt: now,
        decisionNote: "Linked automatically: the customer already had a salesperson",
      },
      select: { id: true },
    });
    if (!convo.assignedToUserId) {
      await prisma.conversation.updateMany({ where: { id: conversationId, assignedToUserId: null }, data: { assignedToUserId: owner.userId } });
    }
    await prisma.aiHotLead.updateMany({ where: { conversationId }, data: { claimedByUserId: owner.userId, claimedAt: now } });
    if (owner.leadId) {
      const lead = await prisma.accountContact.findUnique({ where: { id: owner.leadId }, select: { accountId: true } });
      // The CRM customer only follows if nobody owns it there yet; an existing CRM rep is never replaced.
      if (lead) await reassignCustomerRep({ accountId: lead.accountId, toUserId: owner.userId, actorUserId: owner.userId, onlyIfUnowned: true });
      await logContactEvent({
        contactId: owner.leadId,
        actorUserId: null,
        kind: "escalated",
        summary: `AI chat linked to ${owner.name}, who already had this customer`,
        refId: handoff.id,
      });
    }
    if (rep?.pushEnabled) {
      await sendPushToUser(owner.userId, {
        title: `Your lead ${convo.contactName || convo.contactPhone} is chatting with the AI`,
        body: "You stay their salesperson. The AI answers technical questions and passes every message to you.",
        url: `/ai-chats?c=${conversationId}`,
        tag: `ai-lead-${conversationId}`,
      }).catch(() => undefined);
    }
    await introduceSalesperson(handoff.id);
    return owner;
  } catch (err) {
    console.error("[owners] adopt failed", (err as Error)?.name);
    return null;
  }
}
