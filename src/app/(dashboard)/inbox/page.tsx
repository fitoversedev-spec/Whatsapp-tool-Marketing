import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import InboxClient from "./InboxClient";
import type { Role } from "@/lib/rbac";

const conversationInclude = {
  assignedTo: { select: { name: true } },
  labels: { include: { label: true } },
} as const;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: { conversation?: string };
}) {
  const user = await requireUser();

  const where =
    user.role === "admin"
      ? {}
      : { OR: [{ assignedToUserId: user.id }, { assignedToUserId: null }] };

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: [
      { lastInboundAt: { sort: "desc", nulls: "last" } },
      { lastOutboundAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    take: 100,
    include: conversationInclude,
  });

  // "Open chat" links from Bot Leads / Contact Timeline pass ?conversation=
  // to deep-link straight into that thread. It won't always be among the
  // 100 most-recently-active fetched above (an older or closed one, say) —
  // fetch it directly (still permission-scoped by the same `where`) and
  // prepend it so InboxClient can always select it, not just when it
  // happens to already be in the default list.
  if (searchParams.conversation && !conversations.some((c) => c.id === searchParams.conversation)) {
    const deepLinked = await prisma.conversation.findFirst({
      where: { id: searchParams.conversation, ...where },
      include: conversationInclude,
    });
    if (deepLinked) conversations.unshift(deepLinked);
  }

  // Conversation <-> marketing Contact is a phone-string match, not a real
  // FK (see Conversation/Contact models) — one batched lookup for whether
  // each conversation's contact has already been linked to a CRM
  // AccountContact, so the Inbox header can show "Move to CRM" vs "View in
  // CRM" without a request per conversation.
  const linkedContacts = await prisma.contact.findMany({
    where: { phone: { in: conversations.map((c) => c.contactPhone) } },
    select: { phone: true, accountContactId: true },
  });
  const accountContactIdByPhone = new Map(linkedContacts.map((c) => [c.phone, c.accountContactId]));

  return (
    <InboxClient
      currentUser={{ id: user.id, name: user.name, role: user.role as Role }}
      initialConversations={conversations.map((c) => ({
        id: c.id,
        contactPhone: c.contactPhone,
        contactName: c.contactName,
        assignedToName: c.assignedTo?.name ?? null,
        assignedToUserId: c.assignedToUserId,
        lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
        lastOutboundAt: c.lastOutboundAt?.toISOString() ?? null,
        unreadCount: c.unreadCount,
        status: c.status,
        labelIds: c.labels.map((l) => l.label.id),
        labels: c.labels.map((l) => ({
          id: l.label.id,
          name: l.label.name,
          color: l.label.color,
        })),
        accountContactId: accountContactIdByPhone.get(c.contactPhone) ?? null,
      }))}
      initialSelectedId={searchParams.conversation ?? null}
    />
  );
}
