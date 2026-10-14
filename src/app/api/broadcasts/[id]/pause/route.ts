// Pause a running broadcast. Sets pauseRequestedAt; the sender loop reads
// this between recipient batches and flips status to "paused" + writes
// pausedAt when it actually stops. We don't kill mid-batch — a recipient
// currently being sent gets to finish to avoid double-sends.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requestBroadcastPause } from "@/lib/broadcasts/control";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
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

  // Mark the pause request. The sender loop picks it up on its next iteration
  // and writes pausedAt + status="paused" itself.
  const paused = await requestBroadcastPause(params.id, b.status);
  if (!paused.ok) return NextResponse.json({ error: paused.error }, { status: 422 });

  return NextResponse.json({ ok: true, pauseRequestedAt: paused.pauseRequestedAt });
}
