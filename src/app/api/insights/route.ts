import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const docs = await prisma.insightDocument.findMany({
    where: { authorId: user.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({ documents: docs });
}

const createSchema = z.object({
  title: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const doc = await prisma.insightDocument.create({
    data: {
      authorId: user.id,
      title: parsed.data.title?.trim() || "Untitled",
    },
  });

  return NextResponse.json({ document: doc }, { status: 201 });
}
