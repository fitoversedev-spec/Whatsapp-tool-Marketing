// Add a note to a captured Meta lead's running note log (newest shown first in
// the detail-page sidebar). Open to all approved reps; the author is stamped
// from the session. [id] is the MetaLead.id.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const lead = await prisma.metaLead.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!lead) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const note = await prisma.metaLeadNote.create({
    data: { metaLeadId: params.id, authorUserId: user.id, body: parsed.data.body },
    select: {
      id: true,
      body: true,
      createdAt: true,
      authorUserId: true,
      author: { select: { name: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    note: {
      id: note.id,
      authorUserId: note.authorUserId,
      authorName: note.author?.name ?? user.name,
      body: note.body,
      createdAt: note.createdAt.toISOString(),
    },
  });
}
