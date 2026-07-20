import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";

const createSchema = z.object({
  activityTypeId: z.string().uuid(),
  subject: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  occurredAt: z.string().datetime().optional(),
  durationMins: z.number().int().min(0).max(1440).optional(),
  outcome: z.string().max(500).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const deal = await prisma.deal.findUnique({ where: { id: params.id } });
  if (!deal) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isAdmin(user.role) && deal.ownerUserId && deal.ownerUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const activities = await prisma.activity.findMany({
    where: { dealId: params.id },
    orderBy: { occurredAt: "desc" },
    include: { activityType: { select: { name: true } }, owner: { select: { name: true } } },
  });
  return NextResponse.json({ activities });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const deal = await prisma.deal.findUnique({ where: { id: params.id } });
  if (!deal) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isAdmin(user.role) && deal.ownerUserId && deal.ownerUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const activity = await prisma.activity.create({
    data: {
      dealId: params.id,
      // Was never set — an activity logged here never showed up on this
      // deal's own primary contact's or account's detail page, since both
      // read by accountContactId/accountId, not dealId. Both are already
      // on this deal, no extra query needed.
      accountContactId: deal.primaryContactId,
      accountId: deal.accountId,
      activityTypeId: parsed.data.activityTypeId,
      ownerUserId: user.id,
      subject: parsed.data.subject,
      notes: parsed.data.notes ?? null,
      occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date(),
      durationMins: parsed.data.durationMins ?? null,
      outcome: parsed.data.outcome ?? null,
    },
  });
  return NextResponse.json({ activity });
}
