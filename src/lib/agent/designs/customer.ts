/**
 * Which customer a court design belongs to, and which designs are theirs.
 *
 * The AI names a customer (a CRM lead, or a WhatsApp conversation) and only ever
 * sees that customer's own designs. A design is theirs when it is linked to
 * their contact, their conversation, or carries their phone number. A design
 * with none of those links is invisible to the AI.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { contactsMatchingPhone } from "@/lib/crm/contactLinks";
import { AgentHttpError } from "../errors";

export type DesignCustomer = {
  accountContactId: string | null;
  conversationId: string | null;
  /** E.164 without "+", as Conversation.contactPhone stores it; null when the customer has no usable phone. */
  phone: string | null;
  name: string;
};

const FALLBACK_NAME = "Customer";

export async function resolveDesignCustomer(input: { leadId?: string; conversationId?: string }): Promise<DesignCustomer> {
  if (input.leadId) {
    const c = await prisma.accountContact.findUnique({
      where: { id: input.leadId },
      select: { id: true, name: true, phone: true, deletedAt: true, account: { select: { name: true, deletedAt: true } } },
    });
    if (!c || c.deletedAt || c.account.deletedAt) throw new AgentHttpError("not_found", "Lead not found.");
    const phone = c.phone ? normalizePhone(c.phone) : null;
    const convo = phone
      ? await prisma.conversation.findUnique({ where: { contactPhone: phone }, select: { id: true } })
      : null;
    return {
      accountContactId: c.id,
      conversationId: convo?.id ?? null,
      phone,
      name: c.name?.trim() || c.account.name?.trim() || FALLBACK_NAME,
    };
  }

  const convo = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, contactPhone: true, contactName: true },
  });
  if (!convo) throw new AgentHttpError("not_found", "Conversation not found.");
  const phone = normalizePhone(convo.contactPhone) ?? convo.contactPhone;

  // The CRM person behind this chat: the marketing contact it was moved to the
  // CRM as, else the one live CRM contact with this number.
  const linked = await prisma.contact.findUnique({ where: { phone: convo.contactPhone }, select: { accountContactId: true } });
  let accountContactId = linked?.accountContactId ?? null;
  if (!accountContactId) {
    const matches = await contactsMatchingPhone(phone);
    if (matches.length === 1) accountContactId = matches[0].id;
  }
  let name = convo.contactName?.trim() || null;
  if (!name && accountContactId) {
    const ac = await prisma.accountContact.findUnique({ where: { id: accountContactId }, select: { name: true } });
    name = ac?.name?.trim() || null;
  }
  return { accountContactId, conversationId: convo.id, phone, name: name ?? FALLBACK_NAME };
}

/** Designs whose saved phone is this number (typed in any format). */
export async function designIdsForPhone(phone: string): Promise<string[]> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return [];
  const rows = await prisma.$queryRaw<{ id: string; contact_phone: string }[]>`
    SELECT id, contact_phone FROM "court_images"
    WHERE contact_phone IS NOT NULL
      AND right(regexp_replace(contact_phone, '\\D', '', 'g'), 10) = ${digits.slice(-10)}`;
  return rows.filter((r) => normalizePhone(r.contact_phone) === phone).map((r) => r.id);
}

/** The filter for "this customer's designs", or null when nothing could be theirs. */
export async function designScope(customer: DesignCustomer): Promise<Prisma.CourtImageWhereInput | null> {
  const or: Prisma.CourtImageWhereInput[] = [];
  if (customer.accountContactId) or.push({ accountContactId: customer.accountContactId });
  if (customer.conversationId) or.push({ conversationId: customer.conversationId });
  const byPhone = customer.phone ? await designIdsForPhone(customer.phone) : [];
  if (byPhone.length) or.push({ id: { in: byPhone } });
  return or.length ? { OR: or } : null;
}
