import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/Sidebar";
import CronTick from "@/components/CronTick";
import FloatingChatLauncher from "@/components/chat/FloatingChatLauncher";
import AskAiLauncher from "@/components/AskAiLauncher";
import axios from "axios";
import { getMetaAccessToken } from "@/lib/token-manager";
import { endOfDayIST } from "@/lib/time";
import type { Role } from "@/lib/rbac";

async function checkTokenValid(): Promise<boolean> {
  const token = await getMetaAccessToken();
  const phoneId = process.env.META_PHONE_NUMBER_ID;
  if (!token || !phoneId) return true; // not configured, don't show expired warning
  try {
    // Token-manager auto-refreshes within 5d of expiry, so this check covers
    // the (rare) case where refresh failed or the token was revoked.
    await axios.get(`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || "v21.0"}/${phoneId}?fields=id`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 2000,
    });
    return true;
  } catch (err: any) {
    const code = err?.response?.data?.error?.code;
    // Code 190 = OAuthException (expired/invalid token)
    if (code === 190) return false;
    return true; // network error or other — don't show false alarm
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isAdminUser = user.role === "admin";

  // Unread conversation count — scoped to user's visible conversations.
  // Admin sees all; sales sees own + unassigned (matches inbox filter).
  const unreadWhere =
    isAdminUser
      ? { unreadCount: { gt: 0 } }
      : {
          unreadCount: { gt: 0 },
          OR: [{ assignedToUserId: user.id }, { assignedToUserId: null }],
        };

  // These are all independent — run them in one parallel batch instead of
  // stacking serial round-trips to the Neon pooler. Previously the admin-only
  // pending count and the Meta token check (a graph.facebook.com call, up to
  // 2s) ran serially BEFORE the two counts, so that latency was added to first
  // paint on every dashboard load; now the token check overlaps the DB reads.
  const [pendingCount, tokenValid, unreadAgg, reminderCount, chatAgg, chatMentions] = await Promise.all([
    isAdminUser
      ? prisma.user.count({ where: { approvalStatus: "pending", deletedAt: null } })
      : Promise.resolve(0),
    // Only admins see the token-expiry warning (non-blocking banner)
    isAdminUser ? checkTokenValid() : Promise.resolve(true),
    prisma.conversation.aggregate({ where: unreadWhere, _sum: { unreadCount: true } }),
    // Today's reminder count — overdue + due before end-of-IST-day, excluding
    // completed. IST end-of-day matches the /reminders page filter and prevents
    // off-by-a-day badges on Vercel (UTC server).
    prisma.reminder.count({
      where: {
        ownerUserId: user.id,
        completedAt: null,
        dueAt: { lte: endOfDayIST(new Date()) },
      },
    }),
    // Team-chat unread + unseen mentions, to seed the floating launcher badge
    // on first paint (it then self-polls /api/unread/count like the sidebar).
    prisma.chatParticipant.aggregate({ where: { userId: user.id }, _sum: { unreadCount: true } }),
    prisma.chatMention.count({ where: { mentionedUserId: user.id, seenAt: null } }),
  ]);

  const tokenExpired = !tokenValid;
  const unreadCount = unreadAgg._sum.unreadCount ?? 0;
  const chatUnread = chatAgg._sum.unreadCount ?? 0;

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-slate-50">
      <Sidebar
        user={{
          name: user.name,
          email: user.email,
          role: user.role as Role,
        }}
        pendingCount={pendingCount}
        unreadCount={unreadCount}
        reminderCount={reminderCount}
        tokenExpired={tokenExpired}
      />
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
      <CronTick />
      <FloatingChatLauncher initialUnread={chatUnread} initialMentions={chatMentions} />
      <AskAiLauncher />
    </div>
  );
}
