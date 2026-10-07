import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/Sidebar";
import CronTick from "@/components/CronTick";
import NavigationTracker from "@/components/NavigationTracker";
import FloatingChatLauncher from "@/components/chat/FloatingChatLauncher";
import AskAiLauncher from "@/components/AskAiLauncher";
import CrossTabRefresh from "@/components/CrossTabRefresh";
import PendingNotesFlusher from "@/components/PendingNotesFlusher";
import BottomNav from "@/components/BottomNav";
import SwRegister from "@/components/SwRegister";
import SessionGuard from "@/components/SessionGuard";
import { metaTokenValid } from "@/lib/meta-token-status";
import { endOfDayIST } from "@/lib/time";
import type { Role } from "@/lib/rbac";

// A badge count that fails (DB hiccup, cold start) shows 0 instead of taking
// the whole page down with it — the 30 s badge poll corrects it.
function orZero(p: Promise<number>): Promise<number> {
  return p.catch(() => 0);
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isAdminUser = user.role === "admin";

  // Unread conversation count — scoped to user's visible conversations.
  // Admin sees all; a rep sees ONLY conversations assigned to them (matches
  // the inbox filter — unassigned conversations are admin-only).
  const unreadWhere =
    isAdminUser
      ? { unreadCount: { gt: 0 } }
      : {
          unreadCount: { gt: 0 },
          assignedToUserId: user.id,
        };

  // These are all independent — run them in one parallel batch instead of
  // stacking serial round-trips to the Neon pooler. They seed every badge
  // (sidebar, bottom nav, chat bubble), so the shared badge poller
  // (src/lib/live-counts.ts) doesn't need to re-fetch them on page load.
  const [pendingCount, unreadCount, reminderCount, chatUnread, chatMentions, chatRequests, pendingTemplates] =
    await Promise.all([
      isAdminUser
        ? orZero(prisma.user.count({ where: { approvalStatus: "pending", deletedAt: null } }))
        : 0,
      orZero(
        prisma.conversation
          .aggregate({ where: unreadWhere, _sum: { unreadCount: true } })
          .then((a) => a._sum.unreadCount ?? 0)
      ),
      // Today's reminder count — overdue + due before end-of-IST-day, excluding
      // completed. IST end-of-day matches the /reminders page filter and prevents
      // off-by-a-day badges on Vercel (UTC server).
      // Marketing-only reminders: exclude CRM Deals + CRM Contacts
      orZero(
        prisma.reminder.count({
          where: {
            ownerUserId: user.id,
            completedAt: null,
            dueAt: { lte: endOfDayIST(new Date()) },
            dealId: null,
            accountContactId: null,
          },
        })
      ),
      // Team-chat unread, unseen mentions and pending handoff asks — the
      // floating launcher's badge.
      orZero(
        prisma.chatParticipant
          .aggregate({ where: { userId: user.id }, _sum: { unreadCount: true } })
          .then((a) => a._sum.unreadCount ?? 0)
      ),
      orZero(prisma.chatMention.count({ where: { mentionedUserId: user.id, seenAt: null } })),
      orZero(
        prisma.handoffRequest.count({
          where: isAdminUser
            ? { OR: [{ toUserId: user.id, status: "REQUESTED" }, { kind: "TAKEOVER", status: "ACCEPTED" }] }
            : { toUserId: user.id, status: "REQUESTED" },
        })
      ),
      // Templates awaiting admin review — the admin-only Templates badge.
      isAdminUser
        ? orZero(prisma.template.count({ where: { status: "pending_admin", deletedAt: null } }))
        : 0,
    ]);

  // Admin-only "Meta token expired" warning: the last known answer, re-checked
  // in the background every 10 minutes — the page never waits on Facebook.
  const tokenExpired = isAdminUser && !metaTokenValid();

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50">
      <Sidebar
        user={{
          name: user.name,
          email: user.email,
          role: user.role as Role,
        }}
        pendingCount={pendingCount}
        unreadCount={unreadCount}
        reminderCount={reminderCount}
        pendingTemplates={pendingTemplates}
        tokenExpired={tokenExpired}
      />
      <main className="flex-1 min-w-0 overflow-x-hidden pb-14 md:pb-0">{children}</main>
      <NavigationTracker />
      <CronTick />
      <FloatingChatLauncher
        initialUnread={chatUnread}
        initialMentions={chatMentions}
        initialRequests={chatRequests}
      />
      <AskAiLauncher />
      <CrossTabRefresh events={["marketing:contact-added", "marketing:data-changed"]} />
      <PendingNotesFlusher userId={user.id} />
      <BottomNav reminderCount={reminderCount} />
      <SwRegister userId={user.id} pushEnabled={user.pushEnabled} />
      <SessionGuard />
    </div>
  );
}
