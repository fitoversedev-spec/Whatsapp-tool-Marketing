import { prisma } from "@/lib/prisma";
import { sendInBackground } from "@/lib/broadcast-chain";
import { prepareBroadcast } from "@/lib/sender";

// Launching and pausing a broadcast. Shared by the /api/broadcasts/[id]/launch
// and /pause routes and the AI agent's approved launch and its pause tool.

export type StartBroadcastResult =
  | { kind: "not_launchable" }
  | { kind: "over_limit"; total: number }
  | { kind: "failed"; error: unknown }
  | { kind: "started"; total: number };

/**
 * Claim a draft/scheduled broadcast (atomically, so a second Launch is turned
 * away instead of sending everyone the message twice), build its recipient list
 * from its source, and start sending in the background in ~45 s slices.
 *
 * `verifyTotal` lets the AI agent refuse a list that turned out bigger than its
 * approved limits: it runs after the recipients are built and before anything is
 * sent, and a `false` marks the broadcast failed (so it can never send).
 * `origin` is this deployment's own address; the sender hands each slice over
 * through it.
 */
export async function startBroadcast(
  id: string,
  origin: string,
  opts: { verifyTotal?: (total: number) => Promise<boolean> } = {},
): Promise<StartBroadcastResult> {
  // Allow launching from "draft" (normal) or "scheduled" (manual override —
  // force-fire a scheduled broadcast without waiting for the cron sweep).
  const claimed = await prisma.broadcast.updateMany({
    where: { id, status: { in: ["draft", "scheduled"] } },
    data: { status: "running", launchedAt: new Date() },
  });
  if (claimed.count === 0) return { kind: "not_launchable" };

  try {
    const { total } = await prepareBroadcast(id);
    if (opts.verifyTotal && !(await opts.verifyTotal(total))) {
      await prisma.broadcast.update({ where: { id }, data: { status: "failed" }, select: { id: true } });
      return { kind: "over_limit", total };
    }
    sendInBackground(origin, id);
    return { kind: "started", total };
  } catch (error) {
    await prisma.broadcast.update({ where: { id }, data: { status: "failed" }, select: { id: true } });
    return { kind: "failed", error };
  }
}

export type PauseBroadcastResult = { ok: true; pauseRequestedAt: string } | { ok: false; error: string };

/**
 * Ask a running broadcast to stop. Sets pauseRequestedAt; the sender loop reads
 * this between recipient batches and flips status to "paused" + writes pausedAt
 * when it actually stops. We don't kill mid-batch — a recipient currently being
 * sent gets to finish to avoid double-sends.
 */
export async function requestBroadcastPause(id: string, status: string): Promise<PauseBroadcastResult> {
  if (status !== "running") return { ok: false, error: `Cannot pause a ${status} broadcast` };
  await prisma.broadcast.update({
    where: { id },
    data: { pauseRequestedAt: new Date() },
    select: { id: true },
  });
  return { ok: true, pauseRequestedAt: new Date().toISOString() };
}
