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
import { prepareBroadcast } from "@/lib/sender";
import { sendInBackground } from "@/lib/broadcast-chain";

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
  const claimed = await prisma.broadcast.updateMany({
    where: { id: params.id, status: { in: ["draft", "scheduled"] } },
    data: { status: "running", launchedAt: new Date() },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: `Already ${b.status === "draft" || b.status === "scheduled" ? "launched" : b.status}` }, { status: 422 });
  }

  try {
    const { total } = await prepareBroadcast(params.id);
    sendInBackground(new URL(req.url).origin, params.id);
    return NextResponse.json({ ok: true, status: "running", total }, { status: 200 });
  } catch (err) {
    console.error("[broadcast]", params.id, err);
    await prisma.broadcast.update({
      where: { id: params.id },
      data: { status: "failed" },
      select: { id: true },
    });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "broadcast_failed", message }, { status: 500 });
  }
}
