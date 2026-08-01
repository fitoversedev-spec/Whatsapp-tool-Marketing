// Rep Usage analytics — admin-only. Same gate + param convention as
// /api/crm/analytics/patterns: a real 403 for non-admins (not requireAdmin()'s
// page redirect), from/to as date-only strings with an all-time default.
// Without ?userId → { overview, heatmap } (team). With ?userId → adds that
// rep's session list and their own heatmap for the drill-down.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { getUsageOverview, getUsageHeatmap, getUsageSessions } from "@/lib/analytics/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDateParam(raw: string | null, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const from = parseDateParam(req.nextUrl.searchParams.get("from"), new Date("2000-01-01T00:00:00Z"));
  const toParam = req.nextUrl.searchParams.get("to");
  const to = toParam ? new Date(toParam + "T23:59:59") : new Date();
  const userId = req.nextUrl.searchParams.get("userId") || undefined;

  const [overview, heatmap] = await Promise.all([
    getUsageOverview({ from, to }),
    getUsageHeatmap({ from, to }),
  ]);

  if (userId) {
    const [sessions, userHeatmap] = await Promise.all([
      getUsageSessions({ userId, from, to }),
      getUsageHeatmap({ from, to, userId }),
    ]);
    return NextResponse.json({ overview, heatmap, sessions, userHeatmap });
  }

  return NextResponse.json({ overview, heatmap });
}
