import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import CrmSidebar from "@/components/CrmSidebar";
import CronTick from "@/components/CronTick";
import NavigationTracker from "@/components/NavigationTracker";
import FloatingChatLauncher from "@/components/chat/FloatingChatLauncher";
import AskAiLauncher from "@/components/AskAiLauncher";
import CrossTabRefresh from "@/components/CrossTabRefresh";
import BottomNav from "@/components/BottomNav";
import { endOfDayIST } from "@/lib/time";
import type { Role } from "@/lib/rbac";

export default async function CrmAppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isAdminUser = user.role === "admin";

  const [pendingCount, crmReminderCount, chatAgg, chatMentions] = await Promise.all([
    isAdminUser
      ? prisma.user.count({ where: { approvalStatus: "pending", deletedAt: null } })
      : Promise.resolve(0),
    // CRM-only reminders: linked to a deal or CRM contact
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
    prisma.chatParticipant.aggregate({ where: { userId: user.id }, _sum: { unreadCount: true } }),
    prisma.chatMention.count({ where: { mentionedUserId: user.id, seenAt: null } }),
  ]);

  const chatUnread = chatAgg._sum.unreadCount ?? 0;

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-slate-50">
      <CrmSidebar
        user={{
          name: user.name,
          email: user.email,
          role: user.role as Role,
        }}
        pendingCount={pendingCount}
        reminderCount={crmReminderCount}
      />
      <main className="flex-1 min-w-0 overflow-x-hidden pb-14 lg:pb-0">{children}</main>
      <NavigationTracker />
      <CronTick />
      <FloatingChatLauncher initialUnread={chatUnread} initialMentions={chatMentions} />
      <AskAiLauncher />
      <CrossTabRefresh events={["crm:contact-added", "crm:deal-updated", "crm:data-changed"]} />
      <BottomNav reminderCount={crmReminderCount} />
    </div>
  );
}
