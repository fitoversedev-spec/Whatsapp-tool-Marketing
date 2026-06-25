// Shared logic for "things due now" sweeps. Called from:
//   - /api/cron/sweep — Vercel cron schedule (precise on Pro, ~daily on Hobby)
//   - /api/cron/tick — on-load ping from the dashboard layout (Hobby safety net)
//
// Idempotent: each reminder is marked notifiedAt once; each scheduled broadcast
// flips from "scheduled" to "running" once via a status check inside the
// launch path. Concurrent invocations are safe — runBroadcast itself bails
// if status isn't "draft"/"scheduled".

import { prisma } from "@/lib/prisma";
import { runBroadcast } from "@/lib/sender";

export async function fireDueReminders(): Promise<{ notified: number }> {
  const now = new Date();
  const due = await prisma.reminder.findMany({
    where: {
      completedAt: null,
      notifiedAt: null,
      dueAt: { lte: now },
    },
    take: 100,
  });
  if (due.length === 0) return { notified: 0 };

  await prisma.reminder.updateMany({
    where: { id: { in: due.map((r) => r.id) } },
    data: { notifiedAt: now },
  });
  // In-app notification is rendered by sidebar badge + reminders page;
  // no external send required for the MVP. (Email/WhatsApp notification
  // is a future Phase 2.1 enhancement.)
  return { notified: due.length };
}

export async function launchDueScheduledBroadcasts(): Promise<{ launched: number; failed: number }> {
  const now = new Date();
  const due = await prisma.broadcast.findMany({
    where: {
      status: "scheduled",
      scheduledAt: { lte: now },
    },
    select: { id: true },
    take: 5, // Cap per sweep to avoid runaway timeouts
  });
  let launched = 0;
  let failed = 0;
  for (const b of due) {
    // Atomically claim the broadcast — if another invocation grabbed it,
    // skip silently.
    const claimed = await prisma.broadcast.updateMany({
      where: { id: b.id, status: "scheduled" },
      data: { status: "running", launchedAt: now },
    });
    if (claimed.count === 0) continue;
    try {
      await runBroadcast(b.id);
      launched += 1;
    } catch (err) {
      console.error("[cron] runBroadcast failed", b.id, err);
      await prisma.broadcast.update({
        where: { id: b.id },
        data: { status: "failed" },
      });
      failed += 1;
    }
  }
  return { launched, failed };
}

export async function sweepAll() {
  const [reminders, broadcasts] = await Promise.all([
    fireDueReminders(),
    launchDueScheduledBroadcasts(),
  ]);
  return { reminders, broadcasts, sweptAt: new Date().toISOString() };
}
