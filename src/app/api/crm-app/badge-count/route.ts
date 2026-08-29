import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDayIST } from "@/lib/time";
import { recordHeartbeat } from "@/lib/usage/heartbeat";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const heartbeat = recordHeartbeat(user.id);

  const [reminderCount, chatAgg, chatMentions] = await Promise.all([
    prisma.reminder.count({
      where: {
        ownerUserId: user.id,
        completedAt: null,
        dueAt: { lte: endOfDayIST(new Date()) },
        OR: [
          { dealId: { not: null } },
          { accountContactId: { not: null } },
        ],
      },
    }),
    prisma.chatParticipant.aggregate({
      where: { userId: user.id },
      _sum: { unreadCount: true },
    }),
    prisma.chatMention.count({ where: { mentionedUserId: user.id, seenAt: null } }),
  ]);

  await heartbeat.catch(() => {});

  return NextResponse.json({
    reminders: reminderCount,
    chatUnread: chatAgg._sum.unreadCount ?? 0,
    chatMentions,
  });
}
