// Changing the rep who handles a customer. The rep lives on the company
// (Account.ownerUserId) — it's what decides which rep sees the customer — so
// every path that changes it (contact page, company page, bulk reassign, deal
// edit, chat hand-off) goes through here to keep the knock-on effects the same:
// open deals and their WhatsApp threads follow, pending next-action alerts
// follow, each contact's Timeline records it, and the new rep gets a push.
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { sendPushToUser } from "@/lib/push";
import { logContactEvents } from "./contactEvents";

export async function reassignCustomerRep(args: {
  accountId: string;
  toUserId: string | null;
  actorUserId: string;
}): Promise<{ changed: boolean }> {
  const account = await prisma.account.findUnique({
    where: { id: args.accountId },
    select: {
      id: true,
      name: true,
      ownerUserId: true,
      owner: { select: { name: true } },
      contacts: { where: { deletedAt: null }, select: { id: true, name: true } },
    },
  });
  if (!account || account.ownerUserId === args.toUserId) return { changed: false };

  const toUser = args.toUserId
    ? await prisma.user.findUnique({ where: { id: args.toUserId }, select: { id: true, name: true, pushEnabled: true } })
    : null;
  const contactIds = account.contacts.map((c) => c.id);

  await prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: account.id }, data: { ownerUserId: args.toUserId } });
    if (!args.toUserId) return;

    // Open deals follow the customer; won/lost deals stay credited to the rep
    // who closed them.
    const openDeals = await tx.deal.findMany({
      where: { accountId: account.id, deletedAt: null, currentStage: { stageType: "active" } },
      select: { id: true, conversationId: true },
    });
    if (openDeals.length) {
      await tx.deal.updateMany({ where: { id: { in: openDeals.map((d) => d.id) } }, data: { ownerUserId: args.toUserId } });
      // Same rule as a deal-owner change in PATCH /api/deals/[id]: the deal's
      // WhatsApp thread goes with it.
      const conversationIds = openDeals.map((d) => d.conversationId).filter((id): id is string => !!id);
      if (conversationIds.length) {
        await tx.conversation.updateMany({ where: { id: { in: conversationIds } }, data: { assignedToUserId: args.toUserId } });
      }
    }

    if (contactIds.length) {
      await tx.reminder.updateMany({
        where: { completedAt: null, nextAction: { is: { accountContactId: { in: contactIds }, deletedAt: null, doneAt: null } } },
        data: { ownerUserId: args.toUserId },
      });
    }
  });

  const fromName = account.owner?.name.trim() || "Unassigned";
  const toName = toUser?.name.trim() || "Unassigned";
  await logContactEvents(
    contactIds.map((contactId) => ({
      contactId,
      actorUserId: args.actorUserId,
      kind: "rep_changed" as const,
      summary: `Handled by: ${fromName} → ${toName}`,
    })),
  );
  await writeAudit({
    actorId: args.actorUserId,
    entity: "account",
    entityId: account.id,
    action: "UPDATE",
    diff: { ownerUserId: { from: account.ownerUserId, to: args.toUserId } },
  });

  if (toUser && toUser.id !== args.actorUserId && toUser.pushEnabled) {
    const first = account.contacts[0];
    await sendPushToUser(toUser.id, {
      title: "New customer assigned to you",
      body: first ? `${first.name} (${account.name})` : account.name,
      url: first && account.contacts.length === 1 ? `/crm/contacts/${first.id}` : `/crm/companies/${account.id}`,
      tag: `assign-${account.id}`,
    }).catch(() => null);
  }

  return { changed: true };
}
