// Product interest recorded on the contact itself — no deal needed (deals are
// confirmed projects only). Catalogue products and/or one free-text "Other".
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadContactForUser } from "@/lib/crm/contactAccess";

const schema = z.object({
  productIds: z.array(z.string().uuid()).max(30).default([]),
  otherLabel: z.string().trim().max(200).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadContactForUser(params.id, user, "edit");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (!parsed.data.productIds.length && !parsed.data.otherLabel)) {
    return NextResponse.json({ error: "Pick at least one product" }, { status: 400 });
  }

  // Skip products already recorded for this contact.
  const existing = await prisma.contactProductInterest.findMany({
    where: { accountContactId: params.id, productId: { in: parsed.data.productIds } },
    select: { productId: true },
  });
  const have = new Set(existing.map((e) => e.productId));
  const rows = [
    ...parsed.data.productIds.filter((id) => !have.has(id)).map((productId) => ({ accountContactId: params.id, productId, createdByUserId: user.id })),
    ...(parsed.data.otherLabel ? [{ accountContactId: params.id, label: parsed.data.otherLabel, createdByUserId: user.id }] : []),
  ];
  if (rows.length) await prisma.contactProductInterest.createMany({ data: rows });
  return NextResponse.json({ added: rows.length });
}
