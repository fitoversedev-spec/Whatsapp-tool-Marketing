import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();

  const roleWhere =
    user.role === "admin"
      ? {}
      : { OR: [{ assignedToUserId: user.id }, { assignedToUserId: null }] };

  let conversations;
  if (q) {
    // Search across contact phone, name, AND message body
    const lowerQ = q.toLowerCase();
    // Postgres ilike for case-insensitive partial match
    conversations = await prisma.conversation.findMany({
      where: {
        AND: [
          roleWhere,
          {
            OR: [
              { contactPhone: { contains: lowerQ } },
              { contactName: { contains: lowerQ, mode: "insensitive" } },
              {
                messages: {
                  some: { body: { contains: lowerQ, mode: "insensitive" } },
                },
              },
            ],
          },
        ],
      },
      orderBy: [
        { lastInboundAt: { sort: "desc", nulls: "last" } },
        { lastOutboundAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: 100,
      include: { assignedTo: { select: { name: true } } },
    });
  } else {
    conversations = await prisma.conversation.findMany({
      where: roleWhere,
      orderBy: [
        { lastInboundAt: { sort: "desc", nulls: "last" } },
        { lastOutboundAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: 100,
      include: { assignedTo: { select: { name: true } } },
    });
  }

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      contactPhone: c.contactPhone,
      contactName: c.contactName,
      assignedToName: c.assignedTo?.name ?? null,
      assignedToUserId: c.assignedToUserId,
      lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
      lastOutboundAt: c.lastOutboundAt?.toISOString() ?? null,
      unreadCount: c.unreadCount,
      status: c.status,
    })),
  });
}
