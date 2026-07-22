// "Move to CRM" — the Inbox header button that links a WhatsApp conversation
// to a CRM AccountContact, per explicit decision: a soft nudge (Quote/Design
// keep working unlinked), not a hard gate. One click, no form:
//   1. Already linked (Contact.accountContactId set) -> just return it.
//   2. An AccountContact already exists for this phone -> link to it.
//   3. Otherwise -> create a new Account + AccountContact and link to that.
// The marketing Contact <-> AccountContact relation is the link itself
// (Contact.accountContactId, added specifically for this) — nothing here
// touches Deal; creating a deal/quote from the now-linked contact is a
// separate, later action from the CRM Contact Detail page itself.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findAccountContactDuplicate } from "@/lib/crm/accounts";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const convo = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: { contactPhone: true, contactName: true, assignedToUserId: true },
  });
  if (!convo) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && convo.assignedToUserId !== null && convo.assignedToUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const existingContact = await prisma.contact.findUnique({
    where: { phone: convo.contactPhone },
    select: { id: true, accountContactId: true },
  });
  if (existingContact?.accountContactId) {
    return NextResponse.json({ accountContactId: existingContact.accountContactId, alreadyLinked: true });
  }

  const displayName = convo.contactName?.trim() || "Unknown customer";
  const dup = await findAccountContactDuplicate({ phone: convo.contactPhone, name: displayName });

  const accountContactId = await prisma.$transaction(async (tx) => {
    let targetId: string;
    if (dup) {
      targetId = dup.id;
    } else {
      const account = await tx.account.create({
        data: { name: displayName, ownerUserId: convo.assignedToUserId ?? user.id },
      });
      const contact = await tx.accountContact.create({
        data: { accountId: account.id, name: displayName, phone: convo.contactPhone, isPrimary: true },
      });
      targetId = contact.id;
    }

    if (existingContact) {
      await tx.contact.update({ where: { id: existingContact.id }, data: { accountContactId: targetId } });
    } else {
      // Conversations are supposed to always have a matching marketing
      // Contact row, but don't assume it — upsert rather than 500 if one
      // was somehow missing.
      await tx.contact.upsert({
        where: { phone: convo.contactPhone },
        create: { phone: convo.contactPhone, name: convo.contactName, accountContactId: targetId },
        update: { accountContactId: targetId },
      });
    }
    return targetId;
  });

  return NextResponse.json({ accountContactId, alreadyLinked: false, matchedExisting: !!dup });
}
