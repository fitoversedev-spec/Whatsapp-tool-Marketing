import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import CrmSidebar from "@/components/CrmSidebar";
import CronTick from "@/components/CronTick";
import NavigationTracker from "@/components/NavigationTracker";
import FloatingChatLauncher from "@/components/chat/FloatingChatLauncher";
import AskAiLauncher from "@/components/AskAiLauncher";
import CrossTabRefresh from "@/components/CrossTabRefresh";
import PendingNotesFlusher from "@/components/PendingNotesFlusher";
import BottomNav from "@/components/BottomNav";
import SwRegister from "@/components/SwRegister";
import SessionGuard from "@/components/SessionGuard";
import { endOfDayIST } from "@/lib/time";
import type { Role } from "@/lib/rbac";

// A badge count that fails (DB hiccup, cold start) shows 0 instead of taking
// the whole page down with it — the 30 s badge poll corrects it.
function orZero(p: Promise<number>): Promise<number> {
  return p.catch(() => 0);
}

export default async function CrmAppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isAdminUser = user.role === "admin";

  // Seeds every badge, so the shared badge poller (src/lib/live-counts.ts)
  // doesn't need to re-fetch them on page load.
  const [pendingCount, crmReminderCount, chatUnread, chatMentions, chatRequests] = await Promise.all([
    isAdminUser
      ? orZero(prisma.user.count({ where: { approvalStatus: "pending", deletedAt: null } }))
      : 0,
    // CRM-only reminders: linked to a deal or CRM contact
    orZero(
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
      })
    ),
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
  ]);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50">
      <CrmSidebar
        user={{
          name: user.name,
          email: user.email,
          role: user.role as Role,
        }}
        pendingCount={pendingCount}
        reminderCount={crmReminderCount}
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
      <CrossTabRefresh events={["crm:contact-added", "crm:deal-updated", "crm:data-changed"]} />
      <PendingNotesFlusher userId={user.id} />
      <BottomNav reminderCount={crmReminderCount} />
      <SwRegister userId={user.id} pushEnabled={user.pushEnabled} />
      <SessionGuard />
    </div>
  );
}
