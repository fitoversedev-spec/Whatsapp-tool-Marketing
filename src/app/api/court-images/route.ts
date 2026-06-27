// Court image list + create. Layout JSON is validated with a permissive
// schema — the canvas is the source of truth for shape correctness, not
// the API. We only enforce top-level structure + max size.
//
// Sales sees only their own designs; admin sees everything.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildCourtImageNumber } from "@/lib/court-image/schema";

// Permissive layout validator — we accept anything that looks like
// the right shape and let the canvas reject unknown elements at render
// time. Storing as JSON string is fine because nothing else queries
// inside the column.
const layoutSchema = z
  .object({
    v: z.literal(1),
    plot: z.object({ lengthFt: z.number(), widthFt: z.number() }),
    sports: z.array(z.string()),
    elements: z.array(z.record(z.string(), z.any())),
    style: z.record(z.string(), z.any()),
    title: z.string().optional(),
  })
  .passthrough();

const createSchema = z.object({
  customerName: z.string().min(1).max(200),
  layout: layoutSchema,
  imageUrl: z.string().url().nullable().optional(),
  caption: z.string().max(1024).nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
  contactPhone: z.string().min(5).max(30).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const search = sp.get("search");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (search) {
    const s = search.trim();
    where.OR = [
      { customerName: { contains: s, mode: "insensitive" } },
      { number: { contains: s, mode: "insensitive" } },
      { contactPhone: { contains: s } },
    ];
  }
  if (user.role !== "admin") where.createdByUserId = user.id;

  const items = await prisma.courtImage.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { createdBy: { select: { name: true } } },
  });

  return NextResponse.json({
    courtImages: items.map((c) => ({
      id: c.id,
      number: c.number,
      customerName: c.customerName,
      imageUrl: c.imageUrl,
      caption: c.caption,
      status: c.status,
      conversationId: c.conversationId,
      contactPhone: c.contactPhone,
      sentAt: c.sentAt?.toISOString() ?? null,
      createdByName: c.createdBy.name,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      // Sports chips in the list view — pull from the cached layout.sports.
      sports: safeSports(c.layout),
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const year = new Date().getFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const endOfYear = new Date(Date.UTC(year + 1, 0, 1));
  const countThisYear = await prisma.courtImage.count({
    where: { createdAt: { gte: startOfYear, lt: endOfYear } },
  });
  const number = buildCourtImageNumber(year, countThisYear);

  const row = await prisma.courtImage.create({
    data: {
      number,
      customerName: parsed.data.customerName,
      layout: JSON.stringify(parsed.data.layout),
      imageUrl: parsed.data.imageUrl ?? null,
      caption: parsed.data.caption ?? null,
      conversationId: parsed.data.conversationId ?? null,
      contactPhone: parsed.data.contactPhone ?? null,
      createdByUserId: user.id,
      status: "draft",
    },
  });

  return NextResponse.json({
    courtImage: {
      id: row.id,
      number: row.number,
      status: row.status,
    },
  });
}

function safeSports(layoutJson: string): string[] {
  try {
    const parsed = JSON.parse(layoutJson);
    return Array.isArray(parsed?.sports) ? parsed.sports : [];
  } catch {
    return [];
  }
}
