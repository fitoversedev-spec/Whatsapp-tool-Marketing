import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  dealValue: z.number().min(0).max(99999999).nullable().optional(),
  expectedCloseAt: z.string().datetime().nullable().optional(),
  lostReason: z.string().max(500).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const convo = await prisma.conversation.findUnique({ where: { id: params.id } });
  if (!convo) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (
    user.role !== "admin" &&
    convo.assignedToUserId !== null &&
    convo.assignedToUserId !== user.id
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const updated = await prisma.conversation.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.dealValue !== undefined && { dealValue: parsed.data.dealValue }),
      ...(parsed.data.lostReason !== undefined && { lostReason: parsed.data.lostReason }),
      ...(parsed.data.expectedCloseAt !== undefined && {
        expectedCloseAt:
          parsed.data.expectedCloseAt === null ? null : new Date(parsed.data.expectedCloseAt),
      }),
    },
  });

  return NextResponse.json({
    ok: true,
    conversation: {
      id: updated.id,
      dealValue: updated.dealValue?.toString() ?? null,
      lostReason: updated.lostReason,
      expectedCloseAt: updated.expectedCloseAt?.toISOString() ?? null,
    },
  });
}
