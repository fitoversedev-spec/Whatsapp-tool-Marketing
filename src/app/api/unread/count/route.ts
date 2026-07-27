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

  const [unreadAgg, reminderCount, chatAgg, chatMentions, chatRequests] = await Promise.all([
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
    // Team-chat unread — sum of this user's own per-thread unread counters
    // (same denormalized pattern as Conversation.unreadCount above).
    prisma.chatParticipant.aggregate({
      where: { userId: user.id },
      _sum: { unreadCount: true },
    }),
    // Unseen @mentions of this user, for the launcher's mention badge.
    prisma.chatMention.count({ where: { mentionedUserId: user.id, seenAt: null } }),
    // Pending handoff asks needing this user's attention: requests addressed to
    // them, plus (for admin) takeovers accepted and awaiting approval.
    prisma.handoffRequest.count({
      where:
        user.role === "admin"
          ? { OR: [{ toUserId: user.id, status: "REQUESTED" }, { kind: "TAKEOVER", status: "ACCEPTED" }] }
          : { toUserId: user.id, status: "REQUESTED" },
    }),
  ]);

  return NextResponse.json({
    unread: unreadAgg._sum.unreadCount ?? 0,
    reminders: reminderCount,
    chatUnread: chatAgg._sum.unreadCount ?? 0,
    chatMentions,
    chatRequests,
  });
}
