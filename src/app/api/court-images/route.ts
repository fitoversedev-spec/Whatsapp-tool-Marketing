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
  image2dUrl: z.string().url().nullable().optional(),
  image3dUrl: z.string().url().nullable().optional(),
  video3dUrl: z.string().url().nullable().optional(),
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
  // Same fix as the quotations route — derive next sequential number
  // from the highest existing FIT-CIM-YYYY-NNN row and retry on the
  // unique-constraint race. count()+1 collides as soon as any row gets
  // deleted, which is exactly the symptom prod was hitting.
  let row;
  let lastError: unknown = null;
  let nextSeq = await nextCourtImageSeq(year);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      row = await prisma.courtImage.create({
        data: {
          number: buildCourtImageNumber(year, nextSeq - 1),
          customerName: parsed.data.customerName,
          layout: JSON.stringify(parsed.data.layout),
          imageUrl: parsed.data.imageUrl ?? null,
          image2dUrl: parsed.data.image2dUrl ?? null,
          image3dUrl: parsed.data.image3dUrl ?? null,
          video3dUrl: parsed.data.video3dUrl ?? null,
          caption: parsed.data.caption ?? null,
          conversationId: parsed.data.conversationId ?? null,
          contactPhone: parsed.data.contactPhone ?? null,
          createdByUserId: user.id,
          status: "draft",
        },
      });
      break;
    } catch (err) {
      lastError = err;
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") throw err;
      nextSeq += 1;
    }
  }
  if (!row) {
    console.error("[court-images] number collision after retries", lastError);
    return NextResponse.json(
      {
        error:
          "Could not assign a unique design number after retries. Try again in a moment.",
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    courtImage: {
      id: row.id,
      number: row.number,
      status: row.status,
    },
  });
}

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

// Bulk delete — mirrors the single-item DELETE's admin-only rule exactly
// (src/app/api/court-images/[id]/route.ts).
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json(
      { error: "forbidden", message: "Only an admin can delete designs." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = bulkDeleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const result = await prisma.courtImage.deleteMany({
    where: { id: { in: parsed.data.ids } },
  });
  return NextResponse.json({ ok: true, count: result.count });
}

function safeSports(layoutJson: string): string[] {
  try {
    const parsed = JSON.parse(layoutJson);
    return Array.isArray(parsed?.sports) ? parsed.sports : [];
  } catch {
    return [];
  }
}

// Find the next sequential number for a given calendar year by parsing
// the highest existing FIT-CIM-YYYY-NNN row. Returns 1 if no rows exist
// yet that year.
async function nextCourtImageSeq(year: number): Promise<number> {
  const prefix = `FIT-CIM-${year}-`;
  const latest = await prisma.courtImage.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  if (!latest) return 1;
  const seqStr = latest.number.slice(prefix.length);
  const seq = parseInt(seqStr, 10);
  if (!Number.isFinite(seq)) return 1;
  return seq + 1;
}
