// Create + list Accounts ("Companies") — the CRM's buying-organization
// object, which has had a model since the earlier CRM build but never a
// dedicated CRUD surface (only reachable inline via POST /api/deals).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import { findAccountDuplicate } from "@/lib/crm/accounts";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  city: z.string().max(100).optional(),
  customerProfileId: z.string().uuid().optional(),
  businessType: z.enum(["B2B", "B2C", "B2G"]).optional(),
  gstin: z.string().max(30).optional(),
  notes: z.string().max(4000).optional(),
  confirmDuplicate: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const data = parsed.data;

  if (!data.confirmDuplicate) {
    const candidate = await findAccountDuplicate({ name: data.name, city: data.city, gstin: data.gstin });
    if (candidate) {
      return NextResponse.json({ error: "possible_duplicate", candidate }, { status: 409 });
    }
  }

  const account = await prisma.account.create({
    data: {
      name: data.name,
      city: data.city ?? null,
      customerProfileId: data.customerProfileId ?? null,
      businessType: data.businessType ?? null,
      gstin: data.gstin ?? null,
      notes: data.notes ?? null,
      ownerUserId: user.id,
    },
  });

  return NextResponse.json({ account });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const ownerId = searchParams.get("ownerId");

  const where: Record<string, unknown> = {
    deletedAt: null,
    ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
  };
  if (ownerId) {
    where.ownerUserId = ownerId;
  } else if (!isAdmin(user.role)) {
    where.ownerUserId = user.id;
  }

  const accounts = await prisma.account.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      owner: { select: { id: true, name: true } },
      customerProfile: { select: { id: true, name: true } },
      _count: { select: { deals: true, contacts: true } },
    },
  });

  return NextResponse.json({ accounts });
}
