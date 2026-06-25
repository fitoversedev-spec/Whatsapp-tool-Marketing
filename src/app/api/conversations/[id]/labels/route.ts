// Replace the entire label set on a conversation. Same shape as
// /api/contacts/[id]/tags so the two pickers behave identically.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  labelIds: z.array(z.string().uuid()).max(20),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const convo = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: { id: true, assignedToUserId: true },
  });
  if (!convo) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (
    user.role !== "admin" &&
    convo.assignedToUserId !== null &&
    convo.assignedToUserId !== user.id
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (parsed.data.labelIds.length > 0) {
    const existing = await prisma.conversationLabel.findMany({
      where: { id: { in: parsed.data.labelIds } },
      select: { id: true },
    });
    if (existing.length !== parsed.data.labelIds.length) {
      return NextResponse.json({ error: "One or more label ids are invalid" }, { status: 400 });
    }
  }

  await prisma.$transaction([
    prisma.conversationToLabel.deleteMany({ where: { conversationId: params.id } }),
    prisma.conversationToLabel.createMany({
      data: parsed.data.labelIds.map((labelId) => ({
        conversationId: params.id,
        labelId,
      })),
      skipDuplicates: true,
    }),
  ]);

  const fresh = await prisma.conversationToLabel.findMany({
    where: { conversationId: params.id },
    include: { label: true },
  });
  return NextResponse.json({
    labels: fresh.map((cl) => ({
      id: cl.label.id,
      name: cl.label.name,
      color: cl.label.color,
    })),
  });
}
