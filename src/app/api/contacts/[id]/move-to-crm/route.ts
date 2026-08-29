// "Move to CRM" for a WhatsApp marketing Contact — mirrors the conversation
// move-to-crm flow but starts from a standalone marketing Contact row.
//   1. Already linked (Contact.accountContactId set) → just return it.
//   2. An AccountContact already exists for this phone → link to it.
//   3. Otherwise → create a new Account + AccountContact and link.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findAccountContactDuplicate } from "@/lib/crm/accounts";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const contact = await prisma.contact.findUnique({
    where: { id: params.id },
    select: { id: true, phone: true, name: true, accountContactId: true },
  });
  if (!contact) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (contact.accountContactId) {
    return NextResponse.json({ accountContactId: contact.accountContactId, alreadyLinked: true });
  }

  const displayName = contact.name?.trim() || "Unknown customer";
  const dup = await findAccountContactDuplicate({ phone: contact.phone, name: displayName });

  const accountContactId = await prisma.$transaction(async (tx) => {
    let targetId: string;
    if (dup) {
      targetId = dup.id;
    } else {
      const account = await tx.account.create({
        data: { name: displayName, ownerUserId: user.id },
      });
      const ac = await tx.accountContact.create({
        data: { accountId: account.id, name: displayName, phone: contact.phone, isPrimary: true },
      });
      targetId = ac.id;
    }
    await tx.contact.update({ where: { id: contact.id }, data: { accountContactId: targetId } });
    return targetId;
  });

  return NextResponse.json({ accountContactId, alreadyLinked: false, matchedExisting: !!dup });
}
