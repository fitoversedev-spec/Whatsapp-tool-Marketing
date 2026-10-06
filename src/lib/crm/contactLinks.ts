// Which contact a quotation / court design / reminder belongs to, plus the
// follow-up and timeline bookkeeping around them. Deletions are recorded on
// the Timeline of every contact the document showed on.
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { customerAccess } from "@/lib/rbac";
import { logContactEvents, type ContactEventKind } from "./contactEvents";

export type ResolvedContact = {
  id: string;
  // True when the caller named this contact (accountContactId), not inferred.
  explicit: boolean;
  canView: boolean;
  canEdit: boolean;
};

// The CRM contact a new quotation / court design / reminder is for — they
// attach to the customer instead of creating a deal. In order: the contact
// the caller names, the contact the WhatsApp chat was moved to CRM as, or the
// one live contact with that phone number. Null when unknown. The caller
// decides what to do when the user may not edit the contact.
export async function resolveContactForDocument(
  args: { accountContactId?: string | null; conversationId?: string | null; contactPhone?: string | null },
  user: { id: string; role: string },
): Promise<ResolvedContact | null> {
  const withAccess = async (id: string, explicit: boolean): Promise<ResolvedContact | null> => {
    const c = await prisma.accountContact.findUnique({
      where: { id },
      select: { id: true, deletedAt: true, account: { select: { ownerUserId: true, deletedAt: true } } },
    });
    if (!c || c.deletedAt || c.account.deletedAt) return null;
    return { id: c.id, explicit, ...customerAccess(user, c.account.ownerUserId) };
  };

  if (args.accountContactId) {
    const named = await withAccess(args.accountContactId, true);
    if (named) return named;
  }
  let phone = args.contactPhone ?? null;
  if (args.conversationId) {
    const convo = await prisma.conversation.findUnique({ where: { id: args.conversationId }, select: { contactPhone: true } });
    if (convo) {
      phone = phone ?? convo.contactPhone;
      const linked = await prisma.contact.findUnique({
        where: { phone: convo.contactPhone },
        select: { accountContactId: true },
      });
      if (linked?.accountContactId) {
        const viaChat = await withAccess(linked.accountContactId, false);
        if (viaChat) return viaChat;
      }
    }
  }
  const id = phone ? await uniqueContactIdForPhone(phone) : null;
  return id ? withAccess(id, false) : null;
}

// The one live contact whose phone is this number. Phones are stored as
// typed, so the database compares digits only (last 10) and the normalised
// forms are then checked here.
async function uniqueContactIdForPhone(phone: string): Promise<string | null> {
  const wanted = normalizePhone(phone);
  const digits = (wanted ?? phone).replace(/\D/g, "");
  if (!wanted || digits.length < 10) return null;
  const rows = await prisma.$queryRaw<{ id: string; phone: string }[]>`
    SELECT id, phone FROM "account_contacts"
    WHERE deleted_at IS NULL AND phone IS NOT NULL
      AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = ${digits.slice(-10)}`;
  const matches = rows.filter((c) => normalizePhone(c.phone) === wanted);
  return matches.length === 1 ? matches[0].id : null;
}

// What the quote / design wizard asked about the customer (site city, lead
// source, customer segment, business type) lands on the customer when the
// document isn't on a deal. Segment and business type follow the latest
// choice; the city and lead source only fill in what's still blank.
export async function applyDocumentClassification(args: {
  contactId: string;
  siteCity?: string | null;
  leadSourceId?: string | null;
  customerProfileId?: string | null;
  businessType?: string | null;
}): Promise<void> {
  try {
    const c = await prisma.accountContact.findUnique({
      where: { id: args.contactId },
      select: { id: true, leadSourceId: true, accountId: true, account: { select: { city: true } } },
    });
    if (!c) return;
    const city = args.siteCity?.trim();
    const accountData = {
      ...(args.customerProfileId ? { customerProfileId: args.customerProfileId } : {}),
      ...(args.businessType ? { businessType: args.businessType } : {}),
      ...(city && !c.account.city?.trim() ? { city } : {}),
    };
    if (Object.keys(accountData).length) await prisma.account.update({ where: { id: c.accountId }, data: accountData });
    if (args.leadSourceId && !c.leadSourceId) {
      await prisma.accountContact.update({ where: { id: c.id }, data: { leadSourceId: args.leadSourceId } });
    }
  } catch (err) {
    console.error("[documents] classification write failed", err);
  }
}

async function contactIdsFor(accountContactId: string | null, dealId: string | null, phone: string | null): Promise<string[]> {
  const ids = new Set<string>();
  if (accountContactId) ids.add(accountContactId);
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

// A quotation going out for the first time gets a 3-day follow-up reminder:
// for the rep handling the customer when it's on a contact, otherwise for
// the sender (linked to the WhatsApp chat when there is one).
export async function scheduleQuoteFollowUp(args: {
  quotationNumber: string;
  accountContactId: string | null;
  conversationId?: string | null;
  actorUserId: string;
}): Promise<void> {
  try {
    let ownerUserId = args.actorUserId;
    let accountContactId: string | null = null;
    if (args.accountContactId) {
      const contact = await prisma.accountContact.findUnique({
        where: { id: args.accountContactId },
        select: { deletedAt: true, account: { select: { ownerUserId: true } } },
      });
      if (contact && !contact.deletedAt) {
        accountContactId = args.accountContactId;
        ownerUserId = contact.account.ownerUserId ?? args.actorUserId;
      }
    }
    await prisma.reminder.create({
      data: {
        accountContactId,
        conversationId: accountContactId ? null : args.conversationId ?? null,
        ownerUserId,
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
  doc: {
    kind: "quotation" | "design";
    number: string;
    accountContactId?: string | null;
    dealId: string | null;
    contactPhone: string | null;
    createdAt: Date;
  },
  actorUserId: string,
): Promise<void> {
  try {
    const contactIds = await contactIdsFor(doc.accountContactId ?? null, doc.dealId, doc.kind === "quotation" ? doc.contactPhone : null);
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
