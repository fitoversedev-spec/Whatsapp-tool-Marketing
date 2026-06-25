// Returns notification counts for the current user. Polled by the sidebar
// every ~15 seconds for live badge updates without a full layout refresh.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDayIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const unreadWhere =
    user.role === "admin"
      ? { unreadCount: { gt: 0 } }
      : {
          unreadCount: { gt: 0 },
          OR: [{ assignedToUserId: user.id }, { assignedToUserId: null }],
        };

  const [unreadAgg, reminderCount] = await Promise.all([
    prisma.conversation.aggregate({
      where: unreadWhere,
      _sum: { unreadCount: true },
    }),
    prisma.reminder.count({
      where: {
        ownerUserId: user.id,
        completedAt: null,
        dueAt: { lte: endOfDayIST(new Date()) },
      },
    }),
  ]);

  return NextResponse.json({
    unread: unreadAgg._sum.unreadCount ?? 0,
    reminders: reminderCount,
  });
}
