// CRUD for operational labels applied to conversations. Distinct from
// Pipeline stages (sales funnel) and Tags (contact classification). Use for
// states like "Needs follow-up", "Waiting customer", "Action required".

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  const labels = await prisma.conversationLabel.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { conversations: true } } },
  });

  return NextResponse.json({
    labels: labels.map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      conversationCount: l._count.conversations,
      createdAt: l.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  try {
    const label = await prisma.conversationLabel.create({
      data: { name: parsed.data.name, color: parsed.data.color },
    });
    return NextResponse.json({
      label: {
        id: label.id,
        name: label.name,
        color: label.color,
        conversationCount: 0,
        createdAt: label.createdAt.toISOString(),
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "Label with that name already exists" }, { status: 409 });
    }
    throw err;
  }
}
