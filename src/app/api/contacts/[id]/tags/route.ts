import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const replaceSchema = z.object({
  tagIds: z.array(z.string().uuid()).max(50),
});

// PUT replaces the entire tag set on a contact — simpler client logic than
// add/remove deltas and the join table is cheap.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = replaceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const contact = await prisma.contact.findUnique({ where: { id: params.id } });
  if (!contact) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Validate every tagId exists — otherwise the createMany silently drops bad ones.
  if (parsed.data.tagIds.length > 0) {
    const existing = await prisma.tag.findMany({
      where: { id: { in: parsed.data.tagIds } },
      select: { id: true },
    });
    if (existing.length !== parsed.data.tagIds.length) {
      return NextResponse.json({ error: "One or more tag ids are invalid" }, { status: 400 });
    }
  }

  await prisma.$transaction([
    prisma.contactTag.deleteMany({ where: { contactId: params.id } }),
    prisma.contactTag.createMany({
      data: parsed.data.tagIds.map((tagId) => ({ contactId: params.id, tagId })),
      skipDuplicates: true,
    }),
  ]);

  const fresh = await prisma.contactTag.findMany({
    where: { contactId: params.id },
    include: { tag: true },
  });
  return NextResponse.json({
    tags: fresh.map((ct) => ({ id: ct.tag.id, name: ct.tag.name, color: ct.tag.color })),
  });
}
