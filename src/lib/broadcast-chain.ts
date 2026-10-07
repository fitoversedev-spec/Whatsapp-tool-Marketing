import "server-only";

// Keeps a broadcast sending until everyone has had it.
//
// Each server run sends one slice (~45 s, runSlice in src/lib/sender.ts) and
// then hands over to a fresh run by calling POST /api/broadcasts/[id]/continue
// on this same deployment — so a 6,000-person send isn't cut off when one
// 60-second run ends. The hand-over is signed with SESSION_SECRET so nobody
// else can trigger sends. If a hand-over is ever lost, the 5-minute tick picks
// the broadcast up again (resumeStalledBroadcasts in src/lib/cron-runner.ts).

import { createHmac, timingSafeEqual } from "crypto";
import { after } from "@/lib/scout/after";
import { runSlice } from "@/lib/sender";

// Same secret (and dev fallback) the session cookie uses — src/lib/session.ts.
function secret(): string {
  return process.env.SESSION_SECRET || "dev-only-replace-me-with-32-plus-chars-please";
}

function sign(broadcastId: string, ts: number): string {
  return createHmac("sha256", secret()).update(`broadcast-continue:${broadcastId}:${ts}`).digest("hex");
}

/** True when a hand-over request is genuine and recent (5 minutes). */
export function verifyHandOff(broadcastId: string, ts: unknown, sig: unknown): boolean {
  if (typeof ts !== "number" || !Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60_000) return false;
  if (typeof sig !== "string" || !/^[0-9a-f]{64}$/.test(sig)) return false;
  return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(sign(broadcastId, ts), "hex"));
}

async function handOff(origin: string, broadcastId: string) {
  const ts = Date.now();
  const res = await fetch(`${origin}/api/broadcasts/${broadcastId}/continue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ts, sig: sign(broadcastId, ts) }),
    signal: AbortSignal.timeout(15_000),
  }).catch((err) => {
    console.error("[broadcast] hand-over failed — the 5-minute tick will resume it", broadcastId, err);
    return null;
  });
  if (res && !res.ok) console.error("[broadcast] hand-over rejected", broadcastId, res.status);
}

/**
 * Send the next slice of a "running" broadcast after the current response has
 * gone out, then hand over to a fresh run while anyone is still queued.
 * `origin` is this deployment's own address (from the incoming request).
 */
export function sendInBackground(origin: string, broadcastId: string) {
  after(async () => {
    const { ran, more } = await runSlice(broadcastId);
    if (ran && more) await handOff(origin, broadcastId);
  });
}
