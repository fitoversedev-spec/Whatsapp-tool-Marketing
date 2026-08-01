// Active-time heartbeat. The sidebar and the chat launcher both poll
// GET /api/unread/count every 15s, and only while the browser tab is visible
// (document.visibilityState === "visible"). That poll is our "this rep is
// actively looking at the tool right now" signal — this records it.
//
// Each ping adds the gap since the rep's last ping to their open UserSession's
// activeSeconds, CAPPED at IDLE_CAP: a small gap (a ping or two) means they were
// continuously present, so it counts; a large gap means they were away (tab
// hidden / laptop asleep) and is discarded — that cap is what makes this
// *active* time rather than *tab-open* time.
//
// Race-safety: the two pollers mount together, so their 15s timers fire roughly
// in phase and can hit this within the same instant. We accumulate with ONE
// atomic SQL statement that computes the delta from the row's own last_seen_at
// under a FOR UPDATE lock, so a near-simultaneous second ping sees a ~0 gap and
// cannot double-count. The returned delta is mirrored into the hourly bucket so
// session and bucket totals always agree.

import { prisma } from "@/lib/prisma";
import { startOfHourIST } from "@/lib/time";

// Max seconds a single gap can contribute. A little over two 15s intervals, so
// one dropped ping still counts as continuous presence but a real absence does
// not inflate the total.
const IDLE_CAP_SECONDS = 60;

export async function recordHeartbeat(userId: string): Promise<void> {
  try {
    // Atomically bump the open session and return exactly how many seconds were
    // added (delta). The CTE locks the target row (FOR UPDATE) and RETURNING
    // reads the *pre-update* last_seen_at via the `tgt` CTE, so the delta is the
    // real gap, and concurrent pings serialise to ~0.
    const rows = await prisma.$queryRaw<{ delta: number }[]>`
      WITH tgt AS (
        SELECT id, last_seen_at
        FROM user_sessions
        WHERE user_id = ${userId} AND ended_at IS NULL
        ORDER BY last_seen_at DESC
        LIMIT 1
        FOR UPDATE
      ),
      upd AS (
        UPDATE user_sessions s
        SET active_seconds = s.active_seconds
              + LEAST(${IDLE_CAP_SECONDS}::int, GREATEST(0, EXTRACT(EPOCH FROM (now() - tgt.last_seen_at))::int)),
            last_seen_at = now()
        FROM tgt
        WHERE s.id = tgt.id
        RETURNING LEAST(${IDLE_CAP_SECONDS}::int, GREATEST(0, EXTRACT(EPOCH FROM (now() - tgt.last_seen_at))::int))::int AS delta
      )
      SELECT delta FROM upd
    `;

    if (rows.length === 0) {
      // No open session (e.g. a cookie that outlived a server restart, or the
      // very first ping before login's create landed) — open one now.
      await prisma.userSession.create({ data: { userId } });
      return;
    }

    const delta = Number(rows[0]?.delta ?? 0);
    if (delta > 0) {
      const hourStartAt = startOfHourIST(new Date());
      await prisma.usageHourly.upsert({
        where: { userId_hourStartAt: { userId, hourStartAt } },
        create: { userId, hourStartAt, activeSeconds: delta },
        update: { activeSeconds: { increment: delta } },
      });
    }
  } catch {
    // Usage tracking must NEVER break the badge poll it piggybacks on.
  }
}
