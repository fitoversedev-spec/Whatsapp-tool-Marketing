import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import InboxClient from "./InboxClient";

export default async function InboxPage() {
  const user = await requireUser();

  // Role-based visibility: admin sees all, sales sees own + unassigned
  const where =
    user.role === "admin"
      ? {}
      : {
          OR: [{ assignedToUserId: user.id }, { assignedToUserId: null }],
        };

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: { lastInboundAt: "desc" },
    take: 100,
    include: {
      assignedTo: { select: { name: true } },
    },
  });

  return (
    <InboxClient
      currentUser={{ id: user.id, name: user.name, role: user.role }}
      initialConversations={conversations.map((c) => ({
        id: c.id,
        contactPhone: c.contactPhone,
        contactName: c.contactName,
        assignedToName: c.assignedTo?.name ?? null,
        lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
        lastOutboundAt: c.lastOutboundAt?.toISOString() ?? null,
        unreadCount: c.unreadCount,
        status: c.status,
      }))}
    />
  );
}
