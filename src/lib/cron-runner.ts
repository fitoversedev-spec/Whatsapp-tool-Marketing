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
import { sendText } from "@/lib/whatsapp";
import { runWeeklyDigest } from "@/lib/analytics/digestJob";
import { postThreadNote } from "@/lib/chat/events";

// The weekday the weekly digest fires on — Monday (getDay() 0=Sun..6=Sat).
// A visible default, not a business-mandated day: Monday so the digest lands
// as the week's first working-day briefing. This is a GATE inside the existing
// daily sweep (per the analytics-v2 plan: "reuses the existing daily cron
// rather than adding a second one"), not a second cron entry.
const DIGEST_DAY_OF_WEEK = 1;

// Resolves the phone number to WhatsApp-dispatch a reminder to: the
// reminder's own conversation first (pre-existing behavior's data source),
// falling back to its Deal's primary account contact, then the Deal's own
// linked conversation, and finally its directly-attached account contact
// (dealless contact-page activities). Null = no resolvable number, WhatsApp
// channel skipped silently (the reminder still fires in-app either way).
async function resolveReminderPhone(reminder: {
  conversationId: string | null;
  dealId: string | null;
  accountContactId: string | null;
}): Promise<string | null> {
  if (reminder.conversationId) {
    const c = await prisma.conversation.findUnique({ where: { id: reminder.conversationId }, select: { contactPhone: true } });
    if (c?.contactPhone) return c.contactPhone;
  }
  if (reminder.dealId) {
    const deal = await prisma.deal.findUnique({
      where: { id: reminder.dealId },
      select: {
        conversation: { select: { contactPhone: true } },
        account: { select: { contacts: { where: { isPrimary: true }, take: 1, select: { phone: true } } } },
      },
    });
    const contactPhone = deal?.account.contacts[0]?.phone;
    if (contactPhone) return contactPhone;
    if (deal?.conversation?.contactPhone) return deal.conversation.contactPhone;
  }
  if (reminder.accountContactId) {
    const contact = await prisma.accountContact.findUnique({ where: { id: reminder.accountContactId }, select: { phone: true } });
    if (contact?.phone) return contact.phone;
  }
  return null;
}

export async function fireDueReminders(): Promise<{ notified: number; dispatched: number }> {
  const now = new Date();
  const due = await prisma.reminder.findMany({
    where: {
      completedAt: null,
      notifiedAt: null,
      dueAt: { lte: now },
    },
    take: 100,
  });
  if (due.length === 0) return { notified: 0, dispatched: 0 };

  await prisma.reminder.updateMany({
    where: { id: { in: due.map((r) => r.id) } },
    data: { notifiedAt: now, status: "SENT" },
  });
  // In-app notification is rendered by sidebar badge + reminders page —
  // that part needs no external send, and stays unconditional above.

  // Phase 3 — real outbound dispatch for reminders that opted into the
  // "whatsapp" channel. ReminderDispatch's @@unique([reminderId, channel])
  // is the double-send guard: the row is written (or the P2002 from an
  // already-existing one is caught) BEFORE attempting the send, inside a
  // per-reminder try/catch so one bad number can't block the rest of the sweep.
  let dispatched = 0;
  for (const reminder of due) {
    if (!reminder.channels.includes("whatsapp")) continue;
    try {
      await prisma.reminderDispatch.create({
        data: { reminderId: reminder.id, channel: "whatsapp" },
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "P2002") continue; // already dispatched by a concurrent/earlier sweep
      console.error("[cron] reminder dispatch row failed", reminder.id, err);
      continue;
    }
    try {
      const phone = await resolveReminderPhone(reminder);
      if (!phone) {
        await prisma.reminderDispatch.update({
          where: { reminderId_channel: { reminderId: reminder.id, channel: "whatsapp" } },
          data: { error: "no_resolvable_phone" },
        });
        continue;
      }
      const result = await sendText({ to: phone, body: `⏰ Reminder: ${reminder.message}` });
      await prisma.reminderDispatch.update({
        where: { reminderId_channel: { reminderId: reminder.id, channel: "whatsapp" } },
        data: { providerMessageId: result.waMessageId },
      });
      dispatched += 1;
    } catch (err) {
      console.error("[cron] reminder whatsapp send failed", reminder.id, err);
      await prisma.reminderDispatch
        .update({
          where: { reminderId_channel: { reminderId: reminder.id, channel: "whatsapp" } },
          data: { error: err instanceof Error ? err.message.slice(0, 500) : "send_failed" },
        })
        .catch(() => null);
    }
  }

  return { notified: due.length, dispatched };
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

// Ends coverage windows whose expiresAt has passed: revoke the grant, remove
// the covering rep's COVERING participant row (access already stops the moment
// the grant expires — see loadThreadAuthorized — this just tidies the inbox),
// flip the handoff to REVERTED, and log an in-thread note. Per-item isolated.
export async function revertExpiredCoverage(): Promise<{ reverted: number }> {
  const now = new Date();
  const expired = await prisma.coverageGrant.findMany({
    where: { revokedAt: null, expiresAt: { lt: now } },
    include: { user: { select: { name: true } } },
  });
  let reverted = 0;
  for (const g of expired) {
    try {
      await prisma.coverageGrant.update({ where: { id: g.id }, data: { revokedAt: now } });
      const anchorWhere = g.accountContactId ? { accountContactId: g.accountContactId } : { dealId: g.dealId };
      const thread = await prisma.chatThread.findFirst({ where: anchorWhere, select: { id: true } });
      if (thread) {
        await prisma.chatParticipant.deleteMany({ where: { threadId: thread.id, userId: g.userId, role: "COVERING" } });
        if (g.handoffRequestId) {
          await prisma.handoffRequest.updateMany({ where: { id: g.handoffRequestId, status: "COMPLETED" }, data: { status: "REVERTED" } });
        }
        await postThreadNote(thread.id, g.userId, `⏰ ${g.user.name}'s coverage of this ${g.accountContactId ? "customer" : "deal"} has ended.`);
      }
      reverted++;
    } catch (err) {
      console.error("[cron] coverage revert failed", g.id, err);
    }
  }
  return { reverted };
}

// Closes usage sessions that went stale (no heartbeat for >10 min) — reps
// rarely click logout, so this is the real punch-out for most sessions:
// ended_at = the last time we actually saw them. Active-time totals and the
// live "online now" indicator don't depend on this (they read last_seen_at /
// usage_hourly directly) — this only tidies dangling open sessions.
export async function closeStaleSessions(): Promise<{ closed: number }> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const closed = await prisma.$executeRaw`
    UPDATE user_sessions SET ended_at = last_seen_at
    WHERE ended_at IS NULL AND last_seen_at < ${cutoff}
  `;
  return { closed: Number(closed) || 0 };
}

// Flips unpaid, not-yet-paid invoices to "overdue" once their due date has
// passed. Only touches "issued"/"sent" invoices (never paid/partially_paid/
// cancelled), and only those still owing (amount_paid < grand_total). Payment
// routes recompute status live; this is the time-based transition nothing else
// triggers.
export async function markOverdueInvoices(): Promise<{ overdue: number }> {
  const now = new Date();
  const overdue = await prisma.$executeRaw`
    UPDATE invoices SET status = 'overdue'
    WHERE status IN ('issued', 'sent') AND due_date < ${now} AND amount_paid < grand_total
  `;
  return { overdue: Number(overdue) || 0 };
}

export async function sweepAll() {
  const [reminders, broadcasts, coverage, staleSessions, overdueInvoices] = await Promise.all([
    fireDueReminders(),
    launchDueScheduledBroadcasts(),
    revertExpiredCoverage().catch((err) => {
      console.error("[cron] coverage sweep threw", err);
      return { reverted: 0 };
    }),
    closeStaleSessions().catch((err) => {
      console.error("[cron] stale-session sweep threw", err);
      return { closed: 0 };
    }),
    markOverdueInvoices().catch((err) => {
      console.error("[cron] overdue-invoice sweep threw", err);
      return { overdue: 0 };
    }),
  ]);

  // Day-of-week-gated weekly digest. Wrapped in its own try/catch — and
  // runWeeklyDigest is itself no-throw by contract — so a digest failure can
  // NEVER break the reminders/broadcasts sweep above (which already ran and
  // must always report its result). Same per-item isolation discipline the
  // reminder/broadcast loops use internally. Only attempted on DIGEST_DAY_OF_WEEK.
  let digest: Awaited<ReturnType<typeof runWeeklyDigest>> | { skipped: string } | null = null;
  if (new Date().getDay() === DIGEST_DAY_OF_WEEK) {
    try {
      digest = await runWeeklyDigest();
    } catch (err) {
      // Defence-in-depth: runWeeklyDigest already swallows its own errors, but
      // if it ever regressed to throwing, the sweep still succeeds.
      console.error("[cron] weekly digest failed", err);
      digest = { skipped: err instanceof Error ? err.message : "digest_threw" };
    }
  }

  return { reminders, broadcasts, coverage, staleSessions, overdueInvoices, digest, sweptAt: new Date().toISOString() };
}
