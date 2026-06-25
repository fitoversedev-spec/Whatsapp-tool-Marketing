// Pause a running broadcast. Sets pauseRequestedAt; the sender loop reads
// this between recipient batches and flips status to "paused" + writes
// pausedAt when it actually stops. We don't kill mid-batch — a recipient
// currently being sent gets to finish to avoid double-sends.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = await prisma.broadcast.findUnique({ where: { id: params.id } });
  if (!b) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && b.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (b.status !== "running") {
    return NextResponse.json(
      { error: `Cannot pause a ${b.status} broadcast` },
      { status: 422 }
    );
  }

  // Mark the pause request. The sender loop picks it up on its next iteration
  // and writes pausedAt + status="paused" itself.
  await prisma.broadcast.update({
    where: { id: params.id },
    data: { pauseRequestedAt: new Date() },
  });

  return NextResponse.json({ ok: true, pauseRequestedAt: new Date().toISOString() });
}
