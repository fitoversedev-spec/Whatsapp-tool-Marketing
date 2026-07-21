// General-purpose note log for a contact — deliberately separate from
// Activity (structured: type/subject/duration/outcome). This is a plain
// scratchpad, like Zoho's own Notes tab, not a logged touchpoint — so it's
// never read by any analytics function on purpose (see the model's own
// schema comment).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";

async function loadAuthorized(id: string, userId: string, role: string) {
  const contact = await prisma.accountContact.findUnique({
    where: { id },
    select: { id: true, account: { select: { ownerUserId: true } } },
  });
  if (!contact) return { error: "not_found" as const, status: 404 };
  if (!isAdmin(role) && contact.account.ownerUserId && contact.account.ownerUserId !== userId) {
    return { error: "forbidden" as const, status: 403 };
  }
  return { contact };
}

const createSchema = z.object({
  title: z.string().max(200).optional(),
  body: z.string().min(1).max(5000),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadAuthorized(params.id, user.id, user.role);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const notes = await prisma.accountContactNote.findMany({
    where: { accountContactId: params.id },
    orderBy: { createdAt: "desc" },
    include: { author: { select: { name: true } } },
  });
  return NextResponse.json({ notes });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadAuthorized(params.id, user.id, user.role);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const note = await prisma.accountContactNote.create({
    data: {
      accountContactId: params.id,
      authorUserId: user.id,
      title: parsed.data.title?.trim() || null,
      body: parsed.data.body.trim(),
    },
    include: { author: { select: { name: true } } },
  });
  return NextResponse.json({ note });
}
