// Resume a paused broadcast. Clears the pause flags and sends the rest in the
// background, in slices — it picks up unsent recipients by querying
// BroadcastRecipient.status (src/lib/broadcast-chain.ts).

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendInBackground } from "@/lib/broadcast-chain";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
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

  const claimed = await prisma.broadcast.updateMany({
    where: { id: params.id, status: "paused" },
    data: {
      status: "running",
      pauseRequestedAt: null,
      pausedAt: null,
    },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "Already resumed" }, { status: 422 });
  }

  sendInBackground(new URL(req.url).origin, params.id);
  return NextResponse.json({ ok: true, status: "running" });
}
