import { prisma } from "./prisma";

/**
 * Reconcile broadcast counters from actual BroadcastRecipient data and
 * complete any stale "running" broadcasts whose recipients are all processed.
 */
export async function syncBroadcasts() {
  const broadcasts = await prisma.broadcast.findMany({
    where: { status: { notIn: ["draft", "scheduled"] } },
    select: { id: true, status: true, sent: true, delivered: true, read: true, failed: true, total: true },
  });

  let checked = 0;
  let fixed = 0;
  let completed = 0;

  for (const b of broadcasts) {
    checked++;

    const groups = await prisma.broadcastRecipient.groupBy({
      by: ["status"],
      where: { broadcastId: b.id },
      _count: { _all: true },
    });

    const counters: Record<string, number> = {};
    let totalRecipients = 0;
    for (const g of groups) {
      counters[g.status] = g._count._all;
      totalRecipients += g._count._all;
    }

    const freshSent = counters.sent ?? 0;
    const freshDelivered = counters.delivered ?? 0;
    const freshRead = counters.read ?? 0;
    const freshFailed = counters.failed ?? 0;
    const freshTotal = totalRecipients;

    const countersMatch =
      b.sent === freshSent &&
      b.delivered === freshDelivered &&
      b.read === freshRead &&
      b.failed === freshFailed &&
      b.total === freshTotal;

    const queued = counters.queued ?? 0;
    const shouldComplete = b.status === "running" && queued === 0 && totalRecipients > 0;

    if (!countersMatch || shouldComplete) {
      await prisma.broadcast.update({
        where: { id: b.id },
        data: {
          sent: freshSent,
          delivered: freshDelivered,
          read: freshRead,
          failed: freshFailed,
          total: freshTotal,
          ...(shouldComplete && { status: "completed", completedAt: new Date() }),
        },
      });
      if (!countersMatch) fixed++;
      if (shouldComplete) completed++;
    }
  }

  return { checked, fixed, completed };
}
