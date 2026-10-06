// Which contacts a quotation / court design shows on — the same rule the
// contact page lists them by: the deal's primary contact, or (quotations only)
// a contact whose phone is exactly the quotation's. Used to record deletions
// on those contacts' Timelines.
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { logContactEvents, type ContactEventKind } from "./contactEvents";

// The CRM contact a new quotation / court design / reminder is for — now that
// they attach to the customer instead of creating a deal. In order: the
// contact the caller names, the contact the WhatsApp chat was moved to CRM as,
// or the one live contact with that phone number. Null when unknown.
export async function resolveContactForDocument(args: {
  accountContactId?: string | null;
  conversationId?: string | null;
  contactPhone?: string | null;
}): Promise<string | null> {
  if (args.accountContactId) {
    const c = await prisma.accountContact.findUnique({ where: { id: args.accountContactId }, select: { id: true, deletedAt: true } });
    if (c && !c.deletedAt) return c.id;
  }
  let phone = args.contactPhone ?? null;
  if (args.conversationId) {
    const convo = await prisma.conversation.findUnique({ where: { id: args.conversationId }, select: { contactPhone: true } });
    if (convo) {
      phone = phone ?? convo.contactPhone;
      const linked = await prisma.contact.findUnique({
        where: { phone: convo.contactPhone },
        select: { accountContact: { select: { id: true, deletedAt: true } } },
      });
      if (linked?.accountContact && !linked.accountContact.deletedAt) return linked.accountContact.id;
    }
  }
  const wanted = phone ? normalizePhone(phone) : null;
  if (!wanted) return null;
  // Contact phones are stored as typed, so compare normalised forms.
  const candidates = await prisma.accountContact.findMany({
    where: { deletedAt: null, phone: { not: null } },
    select: { id: true, phone: true },
  });
  const matches = candidates.filter((c) => normalizePhone(c.phone as string) === wanted);
  return matches.length === 1 ? matches[0].id : null;
}

async function contactIdsFor(dealId: string | null, phone: string | null): Promise<string[]> {
  const ids = new Set<string>();
  if (dealId) {
    const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { primaryContactId: true } });
    if (deal?.primaryContactId) ids.add(deal.primaryContactId);
  }
  if (phone) {
    const byPhone = await prisma.accountContact.findMany({ where: { phone, deletedAt: null }, select: { id: true } });
    for (const c of byPhone) ids.add(c.id);
  }
  return Array.from(ids);
}

// A customer's quotation going out for the first time gets the 3-day follow-up
// reminder for the rep handling them. (A quote on a confirmed deal still gets
// the deal's own follow-up from its stage move instead.)
export async function scheduleQuoteFollowUp(args: { quotationNumber: string; accountContactId: string; actorUserId: string }): Promise<void> {
  try {
    const contact = await prisma.accountContact.findUnique({
      where: { id: args.accountContactId },
      select: { deletedAt: true, account: { select: { ownerUserId: true } } },
    });
    if (!contact || contact.deletedAt) return;
    await prisma.reminder.create({
      data: {
        accountContactId: args.accountContactId,
        ownerUserId: contact.account.ownerUserId ?? args.actorUserId,
        message: `Follow up on quotation ${args.quotationNumber}`,
        dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        channels: ["in_app"],
      },
    });
  } catch (err) {
    console.error("[quotations] follow-up reminder failed", err);
  }
}

export async function logDocumentDeleted(
  doc: { kind: "quotation" | "design"; number: string; dealId: string | null; contactPhone: string | null; createdAt: Date },
  actorUserId: string,
): Promise<void> {
  try {
    const contactIds = await contactIdsFor(doc.dealId, doc.kind === "quotation" ? doc.contactPhone : null);
    const kind: ContactEventKind = doc.kind === "quotation" ? "quotation_deleted" : "design_deleted";
    const created = doc.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
    await logContactEvents(
      contactIds.map((contactId) => ({
        contactId,
        actorUserId,
        kind,
        summary: `${doc.kind === "quotation" ? "Quotation" : "Court design"} deleted — ${doc.number}`,
        detail: `Created ${created}`,
      })),
    );
  } catch (err) {
    console.error("[contact-events] document delete log failed", err);
  }
}
