// Rep Usage analytics — read side for the admin "Usage" tab in CRM Analytics.
// Reads the active-time data captured by src/lib/usage/heartbeat.ts:
//   - UsageHourly  → active-second totals + the weekday×hour heatmap (IST)
//   - UserSession  → punch-in / last-active, online-now, session list
// Admin-only (the route enforces it); intentionally NOT owner-scoped — the whole
// point is the admin seeing every rep. All day/hour bucketing is in IST.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { startOfDayIST, startOfWeekIST } from "@/lib/time";

// A rep counts as "online" if we've seen a heartbeat within this window.
const ONLINE_WINDOW_MS = 60_000;

export type UsageOverviewRow = {
  userId: string;
  userName: string;
  role: string;
  online: boolean;
  lastSeenAt: string | null;
  activeSecondsToday: number;
  activeSecondsWeek: number;
  activeSecondsRange: number;
  activeDays: number;
  avgSecondsPerActiveDay: number | null;
  sessionCount: number;
  firstInToday: string | null;
  lastActiveToday: string | null;
};

export type UsageHeatCell = { weekday: number; hour: number; activeSeconds: number };

export type UsageSessionRow = {
  id: string;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  activeSeconds: number;
};

export async function getUsageOverview({ from, to }: { from: Date; to: Date }): Promise<UsageOverviewRow[]> {
  const now = new Date();
  const dayStart = startOfDayIST(now);
  const weekStart = startOfWeekIST(now);

  const [users, rangeRows, todayRows, weekRows, sessionCounts, todaySessions] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null, isActive: true, approvalStatus: "approved" },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    // Range total + distinct active IST-days, in one grouped scan.
    prisma.$queryRaw<{ user_id: string; range_seconds: number; active_days: number }[]>`
      SELECT user_id,
             SUM(active_seconds)::int AS range_seconds,
             COUNT(DISTINCT date_trunc('day', hour_start_at + interval '330 minutes'))::int AS active_days
      FROM usage_hourly
      WHERE hour_start_at >= ${from} AND hour_start_at <= ${to}
      GROUP BY user_id
    `,
    prisma.usageHourly.groupBy({ by: ["userId"], where: { hourStartAt: { gte: dayStart } }, _sum: { activeSeconds: true } }),
    prisma.usageHourly.groupBy({ by: ["userId"], where: { hourStartAt: { gte: weekStart } }, _sum: { activeSeconds: true } }),
    prisma.userSession.groupBy({ by: ["userId"], where: { startedAt: { gte: from, lte: to } }, _count: { _all: true } }),
    // Sessions touched today → punch-in / last-active / online.
    prisma.userSession.findMany({
      where: { lastSeenAt: { gte: dayStart } },
      select: { userId: true, startedAt: true, lastSeenAt: true },
    }),
  ]);

  const rangeMap = new Map(rangeRows.map((r) => [r.user_id, r]));
  const todayMap = new Map(todayRows.map((r) => [r.userId, r._sum.activeSeconds ?? 0]));
  const weekMap = new Map(weekRows.map((r) => [r.userId, r._sum.activeSeconds ?? 0]));
  const sessMap = new Map(sessionCounts.map((r) => [r.userId, r._count._all]));

  const todayAgg = new Map<string, { firstIn: Date; lastActive: Date }>();
  for (const s of todaySessions) {
    // A session that started before today (spanned midnight) has no "login
    // today" — represent its first-in as the start of the day.
    const firstIn = s.startedAt >= dayStart ? s.startedAt : dayStart;
    const cur = todayAgg.get(s.userId);
    if (!cur) {
      todayAgg.set(s.userId, { firstIn, lastActive: s.lastSeenAt });
    } else {
      if (firstIn < cur.firstIn) cur.firstIn = firstIn;
      if (s.lastSeenAt > cur.lastActive) cur.lastActive = s.lastSeenAt;
    }
  }

  const onlineCutoff = new Date(now.getTime() - ONLINE_WINDOW_MS);

  return users.map((u) => {
    const range = rangeMap.get(u.id);
    const rangeSeconds = range?.range_seconds ?? 0;
    const activeDays = range?.active_days ?? 0;
    const t = todayAgg.get(u.id);
    return {
      userId: u.id,
      userName: u.name,
      role: u.role,
      online: !!t && t.lastActive >= onlineCutoff,
      lastSeenAt: t?.lastActive.toISOString() ?? null,
      activeSecondsToday: todayMap.get(u.id) ?? 0,
      activeSecondsWeek: weekMap.get(u.id) ?? 0,
      activeSecondsRange: rangeSeconds,
      activeDays,
      avgSecondsPerActiveDay: activeDays > 0 ? Math.round(rangeSeconds / activeDays) : null,
      sessionCount: sessMap.get(u.id) ?? 0,
      firstInToday: t?.firstIn.toISOString() ?? null,
      lastActiveToday: t?.lastActive.toISOString() ?? null,
    };
  });
}

// weekday: 0=Sun..6=Sat (Postgres EXTRACT(DOW)); hour: 0..23 — both in IST.
export async function getUsageHeatmap({ from, to, userId }: { from: Date; to: Date; userId?: string }): Promise<UsageHeatCell[]> {
  const userFilter = userId ? Prisma.sql`AND user_id = ${userId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ weekday: number; hour: number; active_seconds: number }[]>`
    SELECT EXTRACT(DOW FROM (hour_start_at + interval '330 minutes'))::int AS weekday,
           EXTRACT(HOUR FROM (hour_start_at + interval '330 minutes'))::int AS hour,
           SUM(active_seconds)::int AS active_seconds
    FROM usage_hourly
    WHERE hour_start_at >= ${from} AND hour_start_at <= ${to} ${userFilter}
    GROUP BY 1, 2
  `;
  return rows.map((r) => ({ weekday: r.weekday, hour: r.hour, activeSeconds: r.active_seconds }));
}

export async function getUsageSessions({ userId, from, to }: { userId: string; from: Date; to: Date }): Promise<UsageSessionRow[]> {
  const rows = await prisma.userSession.findMany({
    where: { userId, startedAt: { gte: from, lte: to } },
    orderBy: { startedAt: "desc" },
    take: 200,
    select: { id: true, startedAt: true, lastSeenAt: true, endedAt: true, activeSeconds: true },
  });
  return rows.map((s) => ({
    id: s.id,
    startedAt: s.startedAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    activeSeconds: s.activeSeconds,
  }));
}
