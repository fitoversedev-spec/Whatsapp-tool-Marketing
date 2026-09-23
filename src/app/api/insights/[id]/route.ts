import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function loadOwned(id: string, userId: string) {
  const doc = await prisma.insightDocument.findUnique({ where: { id } });
  if (!doc || doc.deletedAt || doc.authorId !== userId) return null;
  return doc;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const doc = await loadOwned(params.id, user.id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ document: doc });
}

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  body: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const doc = await loadOwned(params.id, user.id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.body !== undefined) data.body = parsed.data.body;

  const updated = await prisma.insightDocument.update({
    where: { id: params.id },
    data,
  });

  return NextResponse.json({ document: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const doc = await loadOwned(params.id, user.id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.insightDocument.update({
    where: { id: params.id },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
