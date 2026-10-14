// Launch a draft broadcast: claim it, build the recipient list from its
// source, reply, then send in the background in ~45 s slices that hand over
// to each other until everyone has had it (src/lib/broadcast-chain.ts).
//
// It used to send the whole list inside this one request; a Vercel run is
// capped at 60 s, so anything past ~150 people was cut off and the broadcast
// stayed stuck on "running".

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startBroadcast } from "@/lib/broadcasts/control";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Only what the checks need — not the whole row (fileData is the uploaded sheet).
  const b = await prisma.broadcast.findUnique({
    where: { id: params.id },
    select: { status: true, createdByUserId: true },
  });
  if (!b) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && b.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Allow launching from "draft" (normal) or "scheduled" (manual override —
  // force-fire a scheduled broadcast without waiting for the cron sweep).
  // Claimed atomically, so a second Launch (double click, second tab) is
  // turned away instead of sending everyone the message twice.
  const started = await startBroadcast(params.id, new URL(req.url).origin);
  if (started.kind === "not_launchable") {
    return NextResponse.json({ error: `Already ${b.status === "draft" || b.status === "scheduled" ? "launched" : b.status}` }, { status: 422 });
  }
  if (started.kind === "failed") {
    console.error("[broadcast]", params.id, started.error);
    const message = started.error instanceof Error ? started.error.message : String(started.error);
    return NextResponse.json({ error: "broadcast_failed", message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, status: "running", total: started.total }, { status: 200 });
}
