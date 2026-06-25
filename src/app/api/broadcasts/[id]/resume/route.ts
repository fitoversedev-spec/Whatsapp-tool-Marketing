// Resume a paused broadcast. Clears the pause flags and re-invokes the
// sender on the same broadcast id. runBroadcast is idempotent — it picks
// up unsent recipients by querying BroadcastRecipient.status.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runBroadcast } from "@/lib/sender";

export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = await prisma.broadcast.findUnique({ where: { id: params.id } });
  if (!b) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && b.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (b.status !== "paused") {
    return NextResponse.json(
      { error: `Cannot resume a ${b.status} broadcast` },
      { status: 422 }
    );
  }

  await prisma.broadcast.update({
    where: { id: params.id },
    data: {
      status: "running",
      pauseRequestedAt: null,
      pausedAt: null,
    },
  });

  try {
    await runBroadcast(params.id);
    return NextResponse.json({ ok: true, status: "completed" });
  } catch (err) {
    console.error("[broadcast/resume]", params.id, err);
    await prisma.broadcast.update({
      where: { id: params.id },
      data: { status: "failed" },
    });
    return NextResponse.json(
      { error: "resume_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
