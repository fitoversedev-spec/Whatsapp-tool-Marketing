// List activities across everything the user can see — the CRM section's
// flat activity feed (distinct from a single deal/company/contact's own
// timeline, which uses getUnifiedTimeline instead). POST logs a new one
// anchored on a contact — not deal-scoped like /api/deals/[id]/activities,
// since a contact can be logged against before any deal exists.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import { createContactActivity } from "@/lib/crm/contactWrites";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ownerId = searchParams.get("ownerId");

  const where: Record<string, unknown> = {};
  if (ownerId) {
    where.ownerUserId = ownerId;
  } else if (!isAdmin(user.role)) {
    where.ownerUserId = user.id;
  }

  const activities = await prisma.activity.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: 100,
    include: {
      activityType: { select: { name: true } },
      owner: { select: { name: true } },
      deal: { select: { id: true, code: true, title: true } },
      account: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({
    activities: activities.map((a) => ({
      id: a.id,
      typeName: a.activityType.name,
      subject: a.subject,
      notes: a.notes,
      occurredAt: a.occurredAt.toISOString(),
      durationMins: a.durationMins,
      outcome: a.outcome,
      ownerName: a.owner.name,
      dealId: a.deal?.id ?? null,
      dealCode: a.deal?.code ?? null,
      dealTitle: a.deal?.title ?? null,
      accountId: a.account?.id ?? null,
      accountName: a.account?.name ?? null,
    })),
  });
}

const createSchema = z.object({
  accountContactId: z.string().uuid(),
  // Optional — a deal this contact already has, so the activity also shows
  // up on that deal's own feed. Verified below to actually belong to the
  // same account rather than trusted as-is from the client.
  dealId: z.string().uuid().optional(),
  activityTypeId: z.string().uuid(),
  subject: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  durationMins: z.number().int().min(0).max(1440).optional(),
  outcome: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const contact = await prisma.accountContact.findUnique({
    where: { id: parsed.data.accountContactId },
    select: { id: true, accountId: true, deletedAt: true, account: { select: { ownerUserId: true } } },
  });
  if (!contact || contact.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isAdmin(user.role) && contact.account.ownerUserId && contact.account.ownerUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const activity = await createContactActivity({
    contact,
    dealId: parsed.data.dealId,
    activityTypeId: parsed.data.activityTypeId,
    ownerUserId: user.id,
    subject: parsed.data.subject,
    notes: parsed.data.notes,
    durationMins: parsed.data.durationMins,
    outcome: parsed.data.outcome,
  });
  return NextResponse.json({ activity });
}
