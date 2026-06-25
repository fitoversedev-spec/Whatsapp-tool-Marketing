import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/Sidebar";
import CronTick from "@/components/CronTick";
import axios from "axios";
import { getMetaAccessToken } from "@/lib/token-manager";
import { endOfDayIST } from "@/lib/time";

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

  // Pending approval count — only fetch for admin so we don't waste queries
  let pendingCount = 0;
  let tokenExpired = false;
  if (user.role === "admin") {
    pendingCount = await prisma.user.count({
      where: { approvalStatus: "pending", deletedAt: null },
    });
    // Only admins see token expiry warning (non-blocking)
    tokenExpired = !(await checkTokenValid());
  }

  // Unread conversation count — scoped to user's visible conversations.
  // Admin sees all; sales sees own + unassigned (matches inbox filter).
  const unreadWhere =
    user.role === "admin"
      ? { unreadCount: { gt: 0 } }
      : {
          unreadCount: { gt: 0 },
          OR: [{ assignedToUserId: user.id }, { assignedToUserId: null }],
        };
  const unreadAgg = await prisma.conversation.aggregate({
    where: unreadWhere,
    _sum: { unreadCount: true },
  });
  const unreadCount = unreadAgg._sum.unreadCount ?? 0;

  // Today's reminder count — overdue + due before end-of-IST-day, excluding
  // completed. Using IST end-of-day matches the /reminders page filter and
  // prevents off-by-a-day badges on Vercel (UTC server).
  const reminderCount = await prisma.reminder.count({
    where: {
      ownerUserId: user.id,
      completedAt: null,
      dueAt: { lte: endOfDayIST(new Date()) },
    },
  });

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-slate-50">
      <Sidebar
        user={{
          name: user.name,
          email: user.email,
          role: user.role as "admin" | "sales",
        }}
        pendingCount={pendingCount}
        unreadCount={unreadCount}
        reminderCount={reminderCount}
        tokenExpired={tokenExpired}
      />
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
      <CronTick />
    </div>
  );
}
