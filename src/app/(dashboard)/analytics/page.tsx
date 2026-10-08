import { requireUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import AnalyticsClient from "./AnalyticsClient";

// Approx Meta India INR rates per conversation. Real billing is per
// 24h conversation window, not per message — we use "delivered" as the
// closest available proxy and show the estimate as such in the UI.
const RATE_INR: Record<string, number> = {
  MARKETING: 0.78,
  UTILITY: 0.115,
  AUTHENTICATION: 0.115,
};

type Range = "7d" | "30d" | "90d" | "all";

function rangeStart(range: Range): Date | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const user = await requireUser();
  const range = (["7d", "30d", "90d", "all"].includes(searchParams.range ?? "")
    ? searchParams.range
    : "30d") as Range;
  const since = rangeStart(range);

  // Sales sees only own broadcasts; admin sees everything.
  const baseFilter = user.role === "admin" ? {} : { createdByUserId: user.id };
  const dateFilter = since ? { createdAt: { gte: since } } : {};

  const broadcasts = await prisma.broadcast.findMany({
    where: { ...baseFilter, ...dateFilter },
    orderBy: { createdAt: "desc" },
    // Only the fields used below — not the whole row (fileData is the uploaded sheet).
    select: {
      id: true,
      name: true,
      status: true,
      total: true,
      sent: true,
      delivered: true,
      read: true,
      failed: true,
      createdAt: true,
      templateId: true,
      template: { select: { name: true, category: true } },
      createdBy: { select: { name: true } },
    },
    take: 200,
  });

  // KPI roll-up
  const totals = broadcasts.reduce(
    (acc, b) => {
      acc.total += b.total;
      acc.sent += b.sent;
      acc.delivered += b.delivered;
      acc.read += b.read;
      acc.failed += b.failed;
      const rate = RATE_INR[b.template.category] ?? 0.5;
      acc.costEstimate += b.delivered * rate;
      return acc;
    },
    { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, costEstimate: 0 }
  );

  // Daily timeline + failure breakdown. Aggregated in the database instead of
  // loading every recipient row of up to 200 broadcasts into memory.
  const broadcastIds = broadcasts.map((b) => b.id);
  const sentAtFilter = since ? { gte: since } : { not: null };

  // Bin by YYYY-MM-DD in IST (UTC+5:30 = +330 min; sent_at is stored as UTC).
  const dayRows = broadcastIds.length
    ? await prisma.$queryRaw<
        { day: string; sent: bigint; delivered: bigint; read_n: bigint; failed: bigint }[]
      >(Prisma.sql`
        SELECT to_char(sent_at + interval '330 minutes', 'YYYY-MM-DD') AS day,
               COUNT(*) AS sent,
               COUNT(delivered_at) AS delivered,
               COUNT(read_at) AS read_n,
               COUNT(*) FILTER (WHERE status = 'failed') AS failed
        FROM broadcast_recipients
        WHERE broadcast_id IN (${Prisma.join(broadcastIds)})
          AND sent_at IS NOT NULL
          ${since ? Prisma.sql`AND sent_at >= ${since}` : Prisma.empty}
        GROUP BY 1
        ORDER BY 1
      `)
    : [];
  const timeline = dayRows.map((r) => ({
    date: r.day,
    sent: Number(r.sent),
    delivered: Number(r.delivered),
    read: Number(r.read_n),
    failed: Number(r.failed),
  }));

  // Per-template performance
  const tmplMap = new Map<
    string,
    {
      templateName: string;
      category: string;
      broadcasts: number;
      sent: number;
      delivered: number;
      read: number;
      failed: number;
    }
  >();
  for (const b of broadcasts) {
    const key = b.templateId;
    if (!tmplMap.has(key)) {
      tmplMap.set(key, {
        templateName: b.template.name,
        category: b.template.category,
        broadcasts: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
      });
    }
    const t = tmplMap.get(key)!;
    t.broadcasts += 1;
    t.sent += b.sent;
    t.delivered += b.delivered;
    t.read += b.read;
    t.failed += b.failed;
  }
  const templates = Array.from(tmplMap.values()).sort((a, b) => b.sent - a.sent);

  // Failure breakdown — failed recipients grouped by errorCode (empty codes skipped).
  // `sample` is one message for the code (the alphabetically last; before, it was
  // whichever failed row the database happened to return first).
  const failureGroups = broadcastIds.length
    ? await prisma.broadcastRecipient.groupBy({
        by: ["errorCode"],
        where: {
          broadcastId: { in: broadcastIds },
          sentAt: sentAtFilter,
          status: "failed",
          errorCode: { not: null },
        },
        _count: { _all: true },
        _max: { errorMessage: true },
      })
    : [];
  const failures = failureGroups
    .filter((g) => !!g.errorCode)
    .map((g) => ({
      code: g.errorCode as string,
      sample: g._max.errorMessage ?? "",
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <AnalyticsClient
      range={range}
      kpis={{
        totalBroadcasts: broadcasts.length,
        totalSent: totals.sent,
        totalDelivered: totals.delivered,
        totalRead: totals.read,
        totalFailed: totals.failed,
        deliveryRate: totals.sent > 0 ? totals.delivered / totals.sent : 0,
        readRate: totals.delivered > 0 ? totals.read / totals.delivered : 0,
        failureRate: totals.sent > 0 ? totals.failed / totals.sent : 0,
        costEstimate: totals.costEstimate,
      }}
      timeline={timeline}
      templates={templates}
      failures={failures}
      broadcasts={broadcasts.map((b) => ({
        id: b.id,
        name: b.name,
        templateName: b.template.name,
        category: b.template.category,
        status: b.status,
        total: b.total,
        sent: b.sent,
        delivered: b.delivered,
        read: b.read,
        failed: b.failed,
        createdByName: b.createdBy.name,
        createdAt: b.createdAt.toISOString(),
        cost: b.delivered * (RATE_INR[b.template.category] ?? 0.5),
      }))}
    />
  );
}
