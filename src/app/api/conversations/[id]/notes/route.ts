import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  body: z.string().min(1).max(4000),
  pinned: z.boolean().optional().default(false),
});

async function assertCanAccess(conversationId: string, userId: string, role: string) {
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, assignedToUserId: true },
  });
  if (!convo) return { error: "not_found" as const, status: 404 };
  if (role !== "admin" && convo.assignedToUserId !== null && convo.assignedToUserId !== userId) {
    return { error: "forbidden" as const, status: 403 };
  }
  return { ok: true as const };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await assertCanAccess(params.id, user.id, user.role);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const notes = await prisma.conversationNote.findMany({
    where: { conversationId: params.id },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    include: { author: { select: { id: true, name: true } } },
  });

  return NextResponse.json({
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      pinned: n.pinned,
      authorId: n.author.id,
      authorName: n.author.name,
      createdAt: n.createdAt.toISOString(),
      editedAt: n.editedAt?.toISOString() ?? null,
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await assertCanAccess(params.id, user.id, user.role);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const note = await prisma.conversationNote.create({
    data: {
      conversationId: params.id,
      authorUserId: user.id,
      body: parsed.data.body,
      pinned: parsed.data.pinned,
    },
    include: { author: { select: { id: true, name: true } } },
  });

  return NextResponse.json({
    note: {
      id: note.id,
      body: note.body,
      pinned: note.pinned,
      authorId: note.author.id,
      authorName: note.author.name,
      createdAt: note.createdAt.toISOString(),
      editedAt: null,
    },
  });
}
