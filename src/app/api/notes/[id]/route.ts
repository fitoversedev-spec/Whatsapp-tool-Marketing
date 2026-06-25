import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  body: z.string().min(1).max(4000).optional(),
  pinned: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const note = await prisma.conversationNote.findUnique({
    where: { id: params.id },
  });
  if (!note) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Body edits restricted to author. Pin toggle allowed for admin too.
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  if (parsed.data.body !== undefined && note.authorUserId !== user.id && user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (parsed.data.pinned !== undefined && note.authorUserId !== user.id && user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const updated = await prisma.conversationNote.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.body !== undefined && {
        body: parsed.data.body,
        editedAt: new Date(),
      }),
      ...(parsed.data.pinned !== undefined && { pinned: parsed.data.pinned }),
    },
    include: { author: { select: { id: true, name: true } } },
  });

  return NextResponse.json({
    note: {
      id: updated.id,
      body: updated.body,
      pinned: updated.pinned,
      authorId: updated.author.id,
      authorName: updated.author.name,
      createdAt: updated.createdAt.toISOString(),
      editedAt: updated.editedAt?.toISOString() ?? null,
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const note = await prisma.conversationNote.findUnique({
    where: { id: params.id },
    select: { authorUserId: true },
  });
  if (!note) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (note.authorUserId !== user.id && user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.conversationNote.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
