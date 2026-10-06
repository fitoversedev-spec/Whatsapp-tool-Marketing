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

  // Only real catalogue products, each once.
  const requested = Array.from(new Set(parsed.data.productIds));
  const known = requested.length
    ? await prisma.product.findMany({ where: { id: { in: requested } }, select: { id: true } })
    : [];
  if (known.length !== requested.length) return NextResponse.json({ error: "One of those products no longer exists" }, { status: 400 });

  // Skip what's already recorded for this contact (products, or the same "Other" text).
  const label = parsed.data.otherLabel || null;
  const existing = await prisma.contactProductInterest.findMany({
    where: {
      accountContactId: params.id,
      OR: [{ productId: { in: requested } }, ...(label ? [{ productId: null, label: { equals: label, mode: "insensitive" as const } }] : [])],
    },
    select: { productId: true, label: true },
  });
  const have = new Set(existing.map((e) => e.productId).filter(Boolean));
  const labelKnown = existing.some((e) => !e.productId);
  const rows = [
    ...requested.filter((id) => !have.has(id)).map((productId) => ({ accountContactId: params.id, productId, createdByUserId: user.id })),
    ...(label && !labelKnown ? [{ accountContactId: params.id, label, createdByUserId: user.id }] : []),
  ];
  if (rows.length) await prisma.contactProductInterest.createMany({ data: rows });
  return NextResponse.json({ added: rows.length });
}
