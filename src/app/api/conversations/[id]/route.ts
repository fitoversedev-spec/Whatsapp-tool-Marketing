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

  // Bridge to Deal.ownerUserId — best-effort, never blocks this response.
  // Before this, reassigning a conversation (the most common admin action
  // that changes who's working a customer) never propagated to the linked
  // Deal at all: the deal kept its original owner forever, silently
  // misattributing it in Team Performance's per-rep views even after a
  // different rep took over. Also applies to unassigning (assignedToUserId
  // set to null) — an ownerless deal self-heals by claiming whoever next
  // actually moves it (see transitionDeal.ts), so this is consistent, not
  // a dead end. See docs/DECISIONS.md.
  if (parsed.data.assignedToUserId !== undefined) {
    await prisma.deal
      .updateMany({
        where: { conversationId: convo.id, deletedAt: null },
        data: { ownerUserId: parsed.data.assignedToUserId },
      })
      .catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
