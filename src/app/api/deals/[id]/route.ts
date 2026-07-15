import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const deal = await prisma.deal.findUnique({
    where: { id: params.id },
    include: {
      account: { include: { contacts: true, customerProfile: true, cityTier: true } },
      primaryContact: true,
      owner: { select: { id: true, name: true } },
      office: true,
      currentStage: true,
      leadSource: true,
      lossReason: true,
      lineItems: true,
      stageHistory: { orderBy: { changedAt: "desc" }, include: { fromStage: true, toStage: true, changedBy: { select: { name: true } } } },
    },
  });
  if (!deal || deal.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isAdmin(user.role) && deal.ownerUserId && deal.ownerUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({ deal });
}

// General field edits — NOT stage (that's transitionDeal via
// [id]/stage/route.ts, the only path allowed to touch currentStageId).
const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  officeId: z.string().uuid().nullable().optional(),
  primaryContactId: z.string().uuid().nullable().optional(),
  siteCity: z.string().max(100).nullable().optional(),
  siteCityTierId: z.string().uuid().nullable().optional(),
  siteState: z.string().max(100).nullable().optional(),
  siteAddress: z.string().max(500).nullable().optional(),
  estimatedValue: z.number().min(0).max(999999999).nullable().optional(),
  quotedValue: z.number().min(0).max(999999999).nullable().optional(),
  expectedCloseAt: z.string().datetime().nullable().optional(),
  deleted: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const deal = await prisma.deal.findUnique({ where: { id: params.id } });
  if (!deal || deal.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isAdmin(user.role) && deal.ownerUserId && deal.ownerUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const { deleted, expectedCloseAt, ...rest } = parsed.data;
  const patch: Record<string, unknown> = { ...rest };
  if (expectedCloseAt !== undefined) patch.expectedCloseAt = expectedCloseAt ? new Date(expectedCloseAt) : null;
  if (deleted) patch.deletedAt = new Date();

  const updated = await prisma.deal.update({ where: { id: params.id }, data: patch });
  return NextResponse.json({ deal: updated });
}
