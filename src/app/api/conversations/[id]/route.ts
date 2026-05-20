import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const patchSchema = z
  .object({
    status: z.enum(["open", "closed"]).optional(),
    assignedToUserId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => d.status !== undefined || d.assignedToUserId !== undefined, {
    message: "At least one of status or assignedToUserId required",
  });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "invalid" }, { status: 400 });
  }

  const convo = await prisma.conversation.findUnique({ where: { id: params.id } });
  if (!convo) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Permission check
  const sales = me.role !== "admin";
  if (sales && convo.assignedToUserId && convo.assignedToUserId !== me.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Sales can only change status (close/reopen on own conversations). Only admin can reassign.
  if (parsed.data.assignedToUserId !== undefined && me.role !== "admin") {
    return NextResponse.json({ error: "Only admin can reassign conversations" }, { status: 403 });
  }

  // If reassigning, validate the target user exists, is approved, active, and not deleted
  if (parsed.data.assignedToUserId) {
    const target = await prisma.user.findUnique({ where: { id: parsed.data.assignedToUserId } });
    if (!target || target.deletedAt || !target.isActive || target.approvalStatus !== "approved") {
      return NextResponse.json({ error: "Target user is not available" }, { status: 422 });
    }
  }

  await prisma.conversation.update({
    where: { id: convo.id },
    data: parsed.data,
  });

  return NextResponse.json({ ok: true });
}
