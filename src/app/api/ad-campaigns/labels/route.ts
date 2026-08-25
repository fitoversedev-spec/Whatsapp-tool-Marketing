// The Meta-lead label catalogue: list every label (GET) and create a new one
// (POST) for the detail-page label picker. Open to all approved reps. Labels are
// a shared, reusable catalogue (like the Meta Leads Centre "add label" chips);
// a lead's applied set is edited via PATCH /api/ad-campaigns/leads/[id].
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LABEL_COLORS } from "@/lib/meta-ads/lead-fields";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const labels = await prisma.metaLeadLabel.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true },
  });
  return NextResponse.json({ labels });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(LABEL_COLORS).default("slate"),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { name, color } = parsed.data;

  // Reuse an existing label with the same name (case-insensitive) rather than
  // erroring on the unique constraint — "add label" should be idempotent.
  const existing = await prisma.metaLeadLabel.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true, color: true },
  });
  if (existing) return NextResponse.json({ ok: true, label: existing, reused: true });

  try {
    const label = await prisma.metaLeadLabel.create({
      data: { name, color },
      select: { id: true, name: true, color: true },
    });
    return NextResponse.json({ ok: true, label, reused: false });
  } catch (e) {
    // Lost the check-then-create race (a concurrent request created the same
    // name first): re-read and hand back the winner rather than 500-ing on the
    // unique constraint. The DB index is case-sensitive, so match exactly here.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await prisma.metaLeadLabel.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
        select: { id: true, name: true, color: true },
      });
      if (winner) return NextResponse.json({ ok: true, label: winner, reused: true });
    }
    throw e;
  }
}
