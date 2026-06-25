import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import InboxClient from "./InboxClient";

export default async function InboxPage() {
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
    include: {
      assignedTo: { select: { name: true } },
      labels: { include: { label: true } },
    },
  });

  return (
    <InboxClient
      currentUser={{ id: user.id, name: user.name, role: user.role as "admin" | "sales" }}
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
      }))}
    />
  );
}
