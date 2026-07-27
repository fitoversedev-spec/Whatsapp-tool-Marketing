// A rep's out-of-office window. POST sets your own leave; GET lists everyone's
// active/upcoming leave so the team knows who's away (and who might need cover).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const createSchema = z
  .object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    note: z.string().max(500).optional(),
  })
  .refine((d) => new Date(d.endsAt) > new Date(d.startsAt), { message: "End must be after start" });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const row = await prisma.userAvailability.create({
    data: {
      userId: user.id,
      startsAt: new Date(parsed.data.startsAt),
      endsAt: new Date(parsed.data.endsAt),
      note: parsed.data.note ?? null,
    },
    select: { id: true },
  });
  return NextResponse.json({ id: row.id });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await prisma.userAvailability.findMany({
    where: { endsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
    include: { user: { select: { name: true } } },
  });
  return NextResponse.json({
    leaves: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.user.name,
      mine: r.userId === user.id,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      note: r.note,
    })),
  });
}
