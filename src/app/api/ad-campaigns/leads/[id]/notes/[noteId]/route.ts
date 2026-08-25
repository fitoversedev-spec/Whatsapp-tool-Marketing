// Delete one note from a captured Meta lead's note log. Only the note's author
// or an admin may delete it. [id] is the MetaLead.id, [noteId] the note id.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; noteId: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const note = await prisma.metaLeadNote.findUnique({
    where: { id: params.noteId },
    select: { id: true, metaLeadId: true, authorUserId: true },
  });
  // Guard the note belongs to this lead (defends against a mismatched URL).
  if (!note || note.metaLeadId !== params.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (note.authorUserId !== user.id && user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.metaLeadNote.delete({ where: { id: params.noteId } });
  return NextResponse.json({ ok: true });
}
