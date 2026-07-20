import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({
    where: { id: params.id },
    include: {
      owner: { select: { id: true, name: true } },
      customerProfile: { select: { id: true, name: true } },
      cityTier: { select: { id: true, name: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      deals: {
        where: { deletedAt: null },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true, code: true, title: true, quotedValue: true, wonValue: true,
          currentStage: { select: { name: true, colorHex: true, stageType: true } },
        },
      },
    },
  });
  if (!account || account.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isAdmin(user.role) && account.ownerUserId && account.ownerUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({ account });
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  city: z.string().max(100).nullable().optional(),
  customerProfileId: z.string().uuid().nullable().optional(),
  businessType: z.enum(["B2B", "B2C", "B2G"]).nullable().optional(),
  gstin: z.string().max(30).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  deleted: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { id: params.id } });
  if (!account || account.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isAdmin(user.role) && account.ownerUserId && account.ownerUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  // Same rule as Deal owner reassignment and delete — admin-only, more
  // consequential than the fields a sales rep can self-edit on their own
  // account.
  if (parsed.data.ownerUserId !== undefined && !isAdmin(user.role)) {
    return NextResponse.json({ error: "Only admin can reassign an account's owner" }, { status: 403 });
  }
  if (parsed.data.deleted && !isAdmin(user.role)) {
    return NextResponse.json({ error: "Only admin can delete an account" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.city !== undefined) data.city = parsed.data.city;
  if (parsed.data.customerProfileId !== undefined) data.customerProfileId = parsed.data.customerProfileId;
  if (parsed.data.businessType !== undefined) data.businessType = parsed.data.businessType;
  if (parsed.data.gstin !== undefined) data.gstin = parsed.data.gstin;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
  if (parsed.data.ownerUserId !== undefined) data.ownerUserId = parsed.data.ownerUserId;
  if (parsed.data.deleted) data.deletedAt = new Date();

  const updated = await prisma.account.update({ where: { id: params.id }, data });
  return NextResponse.json({ account: updated });
}
