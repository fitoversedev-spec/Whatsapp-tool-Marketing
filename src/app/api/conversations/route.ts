import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const where =
    user.role === "admin"
      ? {}
      : { OR: [{ assignedToUserId: user.id }, { assignedToUserId: null }] };

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: { lastInboundAt: "desc" },
    take: 100,
    include: { assignedTo: { select: { name: true } } },
  });

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      contactPhone: c.contactPhone,
      contactName: c.contactName,
      assignedToName: c.assignedTo?.name ?? null,
      lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
      lastOutboundAt: c.lastOutboundAt?.toISOString() ?? null,
      unreadCount: c.unreadCount,
      status: c.status,
    })),
  });
}
