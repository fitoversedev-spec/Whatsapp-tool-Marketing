import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  message: z.string().min(1).max(500).optional(),
  dueAt: z.string().datetime().optional(),
  completed: z.boolean().optional(),
  // Short "what actually happened" note — typically set together with
  // completed: true, but accepted independently too (editable after the
  // fact without re-toggling completion).
  completionNote: z.string().max(1000).nullable().optional(),
});

// A reminder can be updated/deleted by its own owner OR by an admin — the
// contact page surfaces reminders across every owner on the contact's deals,
// so an admin managing that contact must be able to complete a rep's reminder
// (mirrors the owner-or-admin gate on deals/account-contacts).
async function loadOwn(id: string, user: { id: string; role: string }) {
  const r = await prisma.reminder.findUnique({ where: { id } });
  if (!r) return { error: "not_found" as const, status: 404 };
  if (r.ownerUserId !== user.id && !isAdmin(user.role)) return { error: "forbidden" as const, status: 403 };
  return { reminder: r };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadOwn(params.id, user);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.message !== undefined) data.message = parsed.data.message;
  if (parsed.data.dueAt !== undefined) {
    data.dueAt = new Date(parsed.data.dueAt);
    data.notifiedAt = null; // reset notification when rescheduled
  }
  if (parsed.data.completed !== undefined) {
    data.completedAt = parsed.data.completed ? new Date() : null;
    // Keep the informational `status` column consistent with the
    // authoritative completedAt/notifiedAt timestamps it's meant to
    // summarize (see schema comment) — this action used to only ever touch
    // completedAt, leaving status stuck at whatever cron-runner.ts last set
    // ("SENT") even after marking a reminder done, and never reverting it
    // on uncomplete either.
    data.status = parsed.data.completed ? "DONE" : res.reminder.notifiedAt ? "SENT" : "PENDING";
  }
  if (parsed.data.completionNote !== undefined) data.completionNote = parsed.data.completionNote;

  const updated = await prisma.reminder.update({
    where: { id: params.id },
    data,
  });

  return NextResponse.json({
    reminder: {
      id: updated.id,
      conversationId: updated.conversationId,
      message: updated.message,
      dueAt: updated.dueAt.toISOString(),
      completedAt: updated.completedAt?.toISOString() ?? null,
      notifiedAt: updated.notifiedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadOwn(params.id, user);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  await prisma.reminder.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
