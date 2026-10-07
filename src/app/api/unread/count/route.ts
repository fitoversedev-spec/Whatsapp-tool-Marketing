// Returns notification counts for the current user. Polled every 30 s by the
// shared badge poller (src/lib/live-counts.ts) — marketing sidebar, CRM sidebar
// and the team-chat bubble all read this one response.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDayIST } from "@/lib/time";
import { recordHeartbeat } from "@/lib/usage/heartbeat";
import { metaTokenValid } from "@/lib/meta-token-status";
import { keepSessionAlive } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Someone is using the app: keep their sign-in going (cookie re-written at
  // most once a day — see keepSessionAlive).
  await keepSessionAlive().catch(() => {});

  // Active-time heartbeat — this visibility-gated 30s poll doubles as the "rep
  // is on the tool right now" signal. Kick it off in parallel with the count
  // queries below (awaited before returning so it runs on serverless), and
  // never let it affect the response.
  const heartbeat = recordHeartbeat(user.id);

  const unreadWhere =
    user.role === "admin"
      ? { unreadCount: { gt: 0 } }
      : {
          unreadCount: { gt: 0 },
          assignedToUserId: user.id,
        };

  const [unreadAgg, reminderCount, crmReminderCount, chatAgg, chatMentions, chatRequests, pendingTemplates] = await Promise.all([
    prisma.conversation.aggregate({
      where: unreadWhere,
      _sum: { unreadCount: true },
    }),
    // Marketing-only reminders: exclude CRM Deals + CRM Contacts
    prisma.reminder.count({
      where: {
        ownerUserId: user.id,
        completedAt: null,
        dueAt: { lte: endOfDayIST(new Date()) },
        dealId: null,
        accountContactId: null,
      },
    }),
    // CRM-only reminders (linked to a deal or CRM contact) — the CRM sidebar badge
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
    // Templates a rep has submitted that are awaiting admin review — admin-only,
    // so a rep never sees a count. Drives the Templates badge in the sidebar.
    user.role === "admin"
      ? prisma.template.count({ where: { status: "pending_admin", deletedAt: null } })
      : Promise.resolve(0),
  ]);

  await heartbeat.catch(() => {});

  return NextResponse.json({
    unread: unreadAgg._sum.unreadCount ?? 0,
    reminders: reminderCount,
    crmReminders: crmReminderCount,
    chatUnread: chatAgg._sum.unreadCount ?? 0,
    chatMentions,
    chatRequests,
    pendingTemplates,
    // Admin-only "Meta token expired" warning — last known answer, never waits on Facebook.
    tokenExpired: user.role === "admin" ? !metaTokenValid() : false,
  });
}
