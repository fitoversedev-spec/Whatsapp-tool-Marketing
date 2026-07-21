// Attach "interested in" products to an EXISTING deal — same enquiry-only
// DealLineItem write POST /api/deals already does at creation time
// (spec §7.2: product interest must be capturable before a quotation
// exists), just reachable after the fact too, e.g. from a CRM Contact
// page's "+ Product interest" quick action.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";

const schema = z
  .object({
    productIds: z.array(z.string().uuid()).max(20).default([]),
    // Free-text entry for something not in the catalogue — same
    // productId-null/label pattern quote line items already use for
    // rate-sheet categories with no matched Product (see DealLineItem's
    // own schema comment).
    otherLabel: z.string().max(200).optional(),
  })
  .refine((d) => d.productIds.length > 0 || (d.otherLabel && d.otherLabel.trim()), {
    message: "Pick at least one product or describe one",
  });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const deal = await prisma.deal.findUnique({ where: { id: params.id } });
  if (!deal || deal.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isAdmin(user.role) && deal.ownerUserId && deal.ownerUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const products = parsed.data.productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: parsed.data.productIds } },
        select: { id: true, name: true, unit: true, priceInr: true },
      })
    : [];
  if (parsed.data.productIds.length && !products.length && !parsed.data.otherLabel?.trim()) {
    return NextResponse.json({ error: "no_matching_products" }, { status: 400 });
  }

  // Skip products already recorded as enquiry-only for this deal, so
  // clicking the quick-action twice doesn't duplicate line items.
  const existing = await prisma.dealLineItem.findMany({
    where: { dealId: deal.id, isEnquiryOnly: true },
    select: { productId: true, label: true },
  });
  const existingIds = new Set(existing.map((e) => e.productId).filter(Boolean));
  const toAdd = products.filter((p) => !existingIds.has(p.id));

  const otherLabel = parsed.data.otherLabel?.trim();
  const existingLabels = new Set(existing.filter((e) => !e.productId).map((e) => e.label?.toLowerCase()));
  const addOther = !!otherLabel && !existingLabels.has(otherLabel.toLowerCase());

  if (toAdd.length || addOther) {
    await prisma.dealLineItem.createMany({
      data: [
        ...toAdd.map((p) => ({
          dealId: deal.id,
          quotationId: null,
          productId: p.id,
          sportId: null,
          label: p.name,
          quantity: 1,
          unit: p.unit ?? null,
          rate: p.priceInr ?? null,
          amount: null,
          isEnquiryOnly: true,
        })),
        ...(addOther
          ? [{
              dealId: deal.id,
              quotationId: null,
              productId: null,
              sportId: null,
              label: otherLabel!,
              quantity: 1,
              unit: null,
              rate: null,
              amount: null,
              isEnquiryOnly: true,
            }]
          : []),
      ],
    });
  }

  const added = toAdd.length + (addOther ? 1 : 0);
  const skipped = products.length - toAdd.length + (otherLabel && !addOther ? 1 : 0);
  return NextResponse.json({ added, skipped });
}
