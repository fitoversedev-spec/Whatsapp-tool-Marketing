// Add a note to a website lead's running note log (newest shown first). Open to
// all signed-in users; the author is stamped from the session. [id] is WebsiteLead.id.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { addWebsiteLeadNote } from "@/lib/website-leads/writes";

const bodySchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const note = await addWebsiteLeadNote({ websiteLeadId: params.id, authorUserId: user.id, body: parsed.data.body });
  if (!note) return NextResponse.json({ error: "not_found" }, { status: 404 });

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
