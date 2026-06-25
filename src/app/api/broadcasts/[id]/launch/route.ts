// Launch a draft broadcast: materialise recipients from source, send each
// via Cloud API, update counters, mark completed.
//
// Why we AWAIT runBroadcast instead of fire-and-forget:
//   Vercel's serverless functions terminate as soon as the response is
//   returned. A fire-and-forget Promise inside the handler gets killed
//   mid-flight, leaving the broadcast in "draft" status with no recipients
//   enqueued. For small-to-medium broadcasts (~25 contacts on Hobby plan,
//   more on Pro) awaiting completes within timeout.
//
// TODO when broadcasts regularly exceed maxDuration capacity:
//   Split runBroadcast into materialise + dispatch; move dispatch to a
//   /resume endpoint triggered by cron or UI re-invocation.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runBroadcast } from "@/lib/sender";

// Vercel Hobby caps at 10s regardless of this value; Pro/Enterprise honor it.
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = await prisma.broadcast.findUnique({ where: { id: params.id } });
  if (!b) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && b.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Allow launching from "draft" (normal) or "scheduled" (manual override —
  // force-fire a scheduled broadcast without waiting for the cron sweep).
  if (b.status !== "draft" && b.status !== "scheduled") {
    return NextResponse.json({ error: `Already ${b.status}` }, { status: 422 });
  }

  try {
    await runBroadcast(params.id);
    return NextResponse.json({ ok: true, status: "completed" }, { status: 200 });
  } catch (err) {
    console.error("[broadcast]", params.id, err);
    await prisma.broadcast.update({
      where: { id: params.id },
      data: { status: "failed" },
    });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "broadcast_failed", message }, { status: 500 });
  }
}
