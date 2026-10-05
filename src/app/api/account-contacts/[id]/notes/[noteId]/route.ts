// Edit / delete one contact note — its author, or an admin/manager. Delete is a
// soft delete so the contact Timeline keeps showing that the note existed.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageAllCustomers } from "@/lib/rbac";
import { loadContactForUser } from "@/lib/crm/contactAccess";
import { logContactEvent, excerpt } from "@/lib/crm/contactEvents";

async function loadNote(params: { id: string; noteId: string }, user: { id: string; role: string }) {
  const res = await loadContactForUser(params.id, user, "view");
  if (!("contact" in res)) return res;
  const note = await prisma.accountContactNote.findUnique({ where: { id: params.noteId } });
  if (!note || note.deletedAt || note.accountContactId !== params.id) return { error: "not_found" as const, status: 404 };
  if (note.authorUserId !== user.id && !canManageAllCustomers(user.role)) return { error: "forbidden" as const, status: 403 };
  return { note };
}

const patchSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(5000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string; noteId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadNote(params, user);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const title = parsed.data.title !== undefined ? parsed.data.title?.trim() || null : res.note.title;
  const body = parsed.data.body !== undefined ? parsed.data.body.trim() : res.note.body;
  if (title === res.note.title && body === res.note.body) return NextResponse.json({ note: res.note });

  const note = await prisma.accountContactNote.update({
    where: { id: res.note.id },
    data: { title, body, editedAt: new Date() },
    include: { author: { select: { name: true } } },
  });
  // No copy of the text here: the note's own entry shows its current text, and
  // a snapshot would outlive the note if it's deleted later.
  await logContactEvent({
    contactId: params.id,
    actorUserId: user.id,
    kind: "note_edited",
    summary: `Note edited — ${title || excerpt(body)}`,
    refId: note.id,
  });
  return NextResponse.json({ note });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; noteId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadNote(params, user);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  await prisma.accountContactNote.update({ where: { id: res.note.id }, data: { deletedAt: new Date() } });
  await logContactEvent({
    contactId: params.id,
    actorUserId: user.id,
    kind: "note_deleted",
    summary: `Note deleted — ${res.note.title || excerpt(res.note.body)}`,
    refId: res.note.id,
  });
  return NextResponse.json({ ok: true });
}
