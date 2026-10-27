// One note in a website lead's note log. [id] is the WebsiteLead.id, [noteId]
// the note id. Same contract as the ad lead note route
// (/api/ad-campaigns/leads/[id]/notes/[noteId]):
//   PUT    — the Notes box's auto-save. The browser picks the note's id before
//            the first save, so every save of one note is the same request:
//            the first creates the note, later ones update it (its author
//            only). A repeat — a retry, or a save sent while the page closes —
//            can never make a second note.
//   DELETE — the note's author or an admin removes it.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const putSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

const NOTE_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  authorUserId: true,
  author: { select: { name: true } },
} as const;

export async function PUT(req: NextRequest, { params }: { params: { id: string; noteId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!z.string().uuid().safeParse(params.noteId).success) {
    return NextResponse.json({ error: "invalid_note_id" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const body = parsed.data.body;

  const toRow = (n: { id: string; body: string; createdAt: Date; authorUserId: string; author: { name: string } | null }) => ({
    id: n.id,
    authorUserId: n.authorUserId,
    authorName: n.author?.name ?? user.name,
    body: n.body,
    createdAt: n.createdAt.toISOString(),
  });

  const existing = await prisma.websiteLeadNote.findUnique({
    where: { id: params.noteId },
    select: { websiteLeadId: true, authorUserId: true },
  });
  if (existing) {
    if (existing.websiteLeadId !== params.id) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (existing.authorUserId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const note = await prisma.websiteLeadNote.update({ where: { id: params.noteId }, data: { body }, select: NOTE_SELECT });
    return NextResponse.json({ ok: true, note: toRow(note) });
  }

  const lead = await prisma.websiteLead.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true } });
  if (!lead) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const note = await prisma.websiteLeadNote.create({
      data: { id: params.noteId, websiteLeadId: params.id, authorUserId: user.id, body },
      select: NOTE_SELECT,
    });
    return NextResponse.json({ ok: true, note: toRow(note) });
  } catch (err) {
    // The note's first save arrived twice at once and the other one created
    // it — this one is then just an update (still the author's own note only).
    if ((err as { code?: string }).code !== "P2002") throw err;
    const updated = await prisma.websiteLeadNote.updateMany({
      where: { id: params.noteId, websiteLeadId: params.id, authorUserId: user.id },
      data: { body },
    });
    if (updated.count === 0) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const note = await prisma.websiteLeadNote.findUniqueOrThrow({ where: { id: params.noteId }, select: NOTE_SELECT });
    return NextResponse.json({ ok: true, note: toRow(note) });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; noteId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const note = await prisma.websiteLeadNote.findUnique({
    where: { id: params.noteId },
    select: { id: true, websiteLeadId: true, authorUserId: true },
  });
  // Guard the note belongs to this lead (defends against a mismatched URL).
  if (!note || note.websiteLeadId !== params.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (note.authorUserId !== user.id && user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.websiteLeadNote.delete({ where: { id: params.noteId } });
  return NextResponse.json({ ok: true });
}
