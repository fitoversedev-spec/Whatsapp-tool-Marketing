// Thin HTTP wrapper around transitionDeal() — the only place allowed to
// change Deal.currentStageId. Mirrors the permission model already proven
// in the legacy /api/conversations/[id]/stage/route.ts.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import { transitionDeal, TransitionDealError } from "@/lib/funnel/transitionDeal";

const schema = z.object({
  toStageId: z.string().uuid(),
  wonValue: z.number().min(0).max(999999999).nullable().optional(),
  lossReasonId: z.string().uuid().nullable().optional(),
  lossReasonNote: z.string().max(500).nullable().optional(),
  expectedCloseAt: z.string().datetime().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const deal = await prisma.deal.findUnique({ where: { id: params.id } });
  if (!deal || deal.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isAdmin(user.role) && deal.ownerUserId && deal.ownerUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const expectedCloseAt =
    parsed.data.expectedCloseAt === undefined
      ? undefined
      : parsed.data.expectedCloseAt === null
        ? null
        : new Date(parsed.data.expectedCloseAt);

  try {
    const updated = await transitionDeal({
      dealId: params.id,
      toStageId: parsed.data.toStageId,
      userId: user.id,
      wonValue: parsed.data.wonValue,
      lossReasonId: parsed.data.lossReasonId,
      lossReasonNote: parsed.data.lossReasonNote,
      expectedCloseAt,
      note: parsed.data.note,
    });
    return NextResponse.json({ ok: true, deal: updated });
  } catch (err) {
    if (err instanceof TransitionDealError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    throw err;
  }
}
