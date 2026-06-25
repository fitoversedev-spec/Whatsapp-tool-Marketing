import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Recognised tailwind-token color names. Match the pipeline + label palette
// so the whole app uses the same color vocabulary.
const COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "emerald",
  "blue",
  "purple",
  "pink",
] as const;

const createSchema = z.object({
  name: z.string().min(1).max(40).trim(),
  color: z.enum(COLORS).optional().default("slate"),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { contacts: true } } },
  });

  return NextResponse.json({
    tags: tags.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      contactCount: t._count.contacts,
      createdAt: t.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const tag = await prisma.tag.create({
      data: { name: parsed.data.name, color: parsed.data.color },
    });
    return NextResponse.json({
      tag: { id: tag.id, name: tag.name, color: tag.color, contactCount: 0, createdAt: tag.createdAt.toISOString() },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "Tag with that name already exists" }, { status: 409 });
    }
    throw err;
  }
}
