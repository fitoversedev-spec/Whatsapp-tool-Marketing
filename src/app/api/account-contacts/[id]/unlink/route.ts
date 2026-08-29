// "Remove from CRM" — unlinks an AccountContact from all source records
// (MetaLead, marketing Contact) and soft-deletes it, effectively moving it
// back to wherever it came from (Meta leads, WhatsApp marketing, or both).
// The source rows (MetaLead, Contact) are preserved — only the CRM link is
// severed and the CRM-side record (AccountContact + empty Account) cleaned up.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ac = await prisma.accountContact.findUnique({
    where: { id: params.id },
    include: {
      account: { select: { id: true, ownerUserId: true } },
    },
  });
  if (!ac || ac.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!isAdmin(user.role) && ac.account.ownerUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const activeDeals = await prisma.deal.count({
    where: { accountId: ac.accountId, closedAt: null, deletedAt: null },
  });
  if (activeDeals > 0) {
    return NextResponse.json(
      { error: "has_active_deals", message: `This contact has ${activeDeals} active deal(s). Close or reassign them before removing.` },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    // Unlink any MetaLeads pointing to this AccountContact
    await tx.metaLead.updateMany({
      where: { accountContactId: ac.id },
      data: { accountContactId: null },
    });

    // Unlink any marketing Contacts pointing to this AccountContact
    await tx.contact.updateMany({
      where: { accountContactId: ac.id },
      data: { accountContactId: null },
    });

    // Soft-delete the AccountContact
    await tx.accountContact.update({
      where: { id: ac.id },
      data: { deletedAt: new Date() },
    });

    // If the parent Account has no other active contacts, soft-delete it too
    const remaining = await tx.accountContact.count({
      where: { accountId: ac.accountId, deletedAt: null, id: { not: ac.id } },
    });
    if (remaining === 0) {
      await tx.account.update({
        where: { id: ac.accountId },
        data: { deletedAt: new Date() },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
