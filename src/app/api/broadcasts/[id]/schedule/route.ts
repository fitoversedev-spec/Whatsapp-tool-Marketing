// PATCH — change scheduledAt of a scheduled broadcast (reschedule).
// DELETE — cancel the schedule, reverting status to "draft".

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  scheduledAt: z.string().datetime(),
});

async function loadAndAuthorize(id: string, userId: string, role: string) {
  const b = await prisma.broadcast.findUnique({ where: { id } });
  if (!b) return { error: "not_found" as const, status: 404 };
  if (role !== "admin" && b.createdByUserId !== userId) {
    return { error: "forbidden" as const, status: 403 };
  }
  if (b.status !== "scheduled") {
    return { error: `Cannot modify schedule of ${b.status} broadcast`, status: 422 };
  }
  return { broadcast: b };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadAndAuthorize(params.id, user.id, user.role);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const candidate = new Date(parsed.data.scheduledAt);
  const minFuture = new Date(Date.now() + 2 * 60 * 1000);
  const maxFuture = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  if (candidate < minFuture) {
    return NextResponse.json(
      { error: "Scheduled time must be at least 2 minutes in the future" },
      { status: 422 }
    );
  }
  if (candidate > maxFuture) {
    return NextResponse.json(
      { error: "Scheduled time must be within 90 days" },
      { status: 422 }
    );
  }

  const updated = await prisma.broadcast.update({
    where: { id: params.id },
    data: { scheduledAt: candidate },
  });
  return NextResponse.json({
    ok: true,
    scheduledAt: updated.scheduledAt?.toISOString() ?? null,
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadAndAuthorize(params.id, user.id, user.role);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  await prisma.broadcast.update({
    where: { id: params.id },
    data: { status: "draft", scheduledAt: null },
  });
  return NextResponse.json({ ok: true });
}
