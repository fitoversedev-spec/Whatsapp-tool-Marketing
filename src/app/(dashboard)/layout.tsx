import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/Sidebar";
import axios from "axios";
import { getMetaAccessToken } from "@/lib/token-manager";

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

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-slate-50">
      <Sidebar
        user={{
          name: user.name,
          email: user.email,
          role: user.role as "admin" | "sales",
        }}
        pendingCount={pendingCount}
        tokenExpired={tokenExpired}
      />
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}
