import { requireUser } from "@/lib/auth";
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
    include: {
      template: { select: { name: true, language: true, category: true } },
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

  // Daily timeline — query recipients in range, group by sent date.
  const broadcastIds = broadcasts.map((b) => b.id);
  const recipients = broadcastIds.length
    ? await prisma.broadcastRecipient.findMany({
        where: {
          broadcastId: { in: broadcastIds },
          sentAt: since ? { gte: since } : { not: null },
        },
        select: {
          broadcastId: true,
          status: true,
          errorCode: true,
          errorMessage: true,
          sentAt: true,
          deliveredAt: true,
          readAt: true,
        },
      })
    : [];

  // Build daily series. We bin by YYYY-MM-DD in IST.
  const dayMap = new Map<
    string,
    { date: string; sent: number; delivered: number; read: number; failed: number }
  >();
  for (const r of recipients) {
    if (!r.sentAt) continue;
    const day = istDateKey(r.sentAt);
    if (!dayMap.has(day)) {
      dayMap.set(day, { date: day, sent: 0, delivered: 0, read: 0, failed: 0 });
    }
    const bucket = dayMap.get(day)!;
    bucket.sent += 1;
    if (r.deliveredAt) bucket.delivered += 1;
    if (r.readAt) bucket.read += 1;
    if (r.status === "failed") bucket.failed += 1;
  }
  const timeline = Array.from(dayMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

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

  // Failure breakdown — group recipients by errorCode
  const failureMap = new Map<string, { code: string; sample: string; count: number }>();
  for (const r of recipients) {
    if (r.status !== "failed" || !r.errorCode) continue;
    if (!failureMap.has(r.errorCode)) {
      failureMap.set(r.errorCode, {
        code: r.errorCode,
        sample: r.errorMessage ?? "",
        count: 0,
      });
    }
    failureMap.get(r.errorCode)!.count += 1;
  }
  const failures = Array.from(failureMap.values()).sort((a, b) => b.count - a.count);

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

function istDateKey(d: Date): string {
  const utc = d.getTime();
  // IST is UTC+5:30
  const ist = new Date(utc + 5.5 * 60 * 60 * 1000);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
