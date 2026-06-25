import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPipelineStages } from "@/lib/pipeline-server";

const schema = z.object({
  toStage: z.string().min(1).max(40),
  // Optional close-out details — required when moving INTO a won/lost stage.
  dealValue: z.number().min(0).max(99999999).nullable().optional(),
  lostReason: z.string().max(500).nullable().optional(),
  expectedCloseAt: z.string().datetime().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const convo = await prisma.conversation.findUnique({ where: { id: params.id } });
  if (!convo) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Permission: admin or assigned-to (or anyone if unassigned and role is sales)
  if (
    user.role !== "admin" &&
    convo.assignedToUserId !== null &&
    convo.assignedToUserId !== user.id
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const stages = await getPipelineStages();
  const targetStage = stages.find((s) => s.id === parsed.data.toStage);
  if (!targetStage) {
    return NextResponse.json({ error: `Unknown stage: ${parsed.data.toStage}` }, { status: 400 });
  }

  // Won/Lost stages require closeout details when not already set.
  if (targetStage.type === "won" && parsed.data.dealValue == null && convo.dealValue == null) {
    return NextResponse.json(
      { error: "Deal value required to mark won" },
      { status: 422 }
    );
  }
  if (
    targetStage.type === "lost" &&
    !parsed.data.lostReason?.trim() &&
    !convo.lostReason?.trim()
  ) {
    return NextResponse.json(
      { error: "Lost reason required to mark lost" },
      { status: 422 }
    );
  }

  // No-op if already in target stage (but still allow updating closeout details)
  const fromStage = convo.pipelineStage;
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.conversation.update({
      where: { id: params.id },
      data: {
        pipelineStage: targetStage.id,
        stageChangedAt: fromStage === targetStage.id ? convo.stageChangedAt : now,
        dealValue: parsed.data.dealValue ?? convo.dealValue,
        lostReason: parsed.data.lostReason ?? convo.lostReason,
        expectedCloseAt:
          parsed.data.expectedCloseAt !== undefined
            ? parsed.data.expectedCloseAt === null
              ? null
              : new Date(parsed.data.expectedCloseAt)
            : convo.expectedCloseAt,
      },
    });
    if (fromStage !== targetStage.id) {
      await tx.pipelineStageHistory.create({
        data: {
          conversationId: params.id,
          fromStage,
          toStage: targetStage.id,
          changedByUserId: user.id,
        },
      });
    }
    return c;
  });

  return NextResponse.json({
    ok: true,
    conversation: {
      id: updated.id,
      pipelineStage: updated.pipelineStage,
      stageChangedAt: updated.stageChangedAt?.toISOString() ?? null,
      dealValue: updated.dealValue?.toString() ?? null,
      lostReason: updated.lostReason,
      expectedCloseAt: updated.expectedCloseAt?.toISOString() ?? null,
    },
  });
}
