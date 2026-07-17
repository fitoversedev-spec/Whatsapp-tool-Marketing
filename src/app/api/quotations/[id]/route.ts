import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recompute, lineItemSchema, type QuoteLineItem } from "@/lib/quotation/calculator";
import { reconcileDealAfterQuotationDelete } from "@/lib/crm/deals";

const patchSchema = z.object({
  customerName: z.string().min(1).max(200).optional(),
  lengthFt: z.number().int().min(1).max(10_000).optional(),
  widthFt: z.number().int().min(1).max(10_000).optional(),
  // Uses the SAME lineItemSchema as POST /api/quotations (imageUrl/section/
  // unit/specs/productId) — these two used to diverge, with PATCH silently
  // dropping those four fields (see docs/DECISIONS.md).
  lineItems: z.array(lineItemSchema).optional(),
  notes: z.string().max(4000).optional(),
  validityDays: z.number().int().min(1).max(365).optional(),
  status: z.enum(["draft", "sent", "viewed", "accepted", "expired", "rejected", "superseded"]).optional(),
  dealId: z.string().uuid().nullable().optional(),
  // Lets a draft created with no phone (the standalone "New Quote" flow
  // previously had no field for this at all — see docs/DECISIONS.md) be
  // corrected from the /quotations list without recreating the quote.
  contactPhone: z.string().min(5).max(30).nullable().optional(),
});

async function loadAuthorized(id: string, userId: string, role: string) {
  const q = await prisma.quotation.findUnique({ where: { id } });
  if (!q) return { error: "not_found" as const, status: 404 };
  if (role !== "admin" && q.createdByUserId !== userId) {
    return { error: "forbidden" as const, status: 403 };
  }
  return { quotation: q };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await loadAuthorized(params.id, user.id, user.role);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const q = res.quotation;
  return NextResponse.json({
    quotation: {
      id: q.id,
      number: q.number,
      customerName: q.customerName,
      sport: q.sport,
      lengthFt: q.lengthFt,
      widthFt: q.widthFt,
      lineItems: JSON.parse(q.lineItems) as QuoteLineItem[],
      subtotal: q.subtotal.toString(),
      gstAmount: q.gstAmount.toString(),
      grandTotal: q.grandTotal.toString(),
      notes: q.notes,
      pdfUrl: q.pdfUrl,
      status: q.status,
      quoteDate: q.quoteDate.toISOString(),
      validityDays: q.validityDays,
      sentAt: q.sentAt?.toISOString() ?? null,
      conversationId: q.conversationId,
      contactPhone: q.contactPhone,
      createdAt: q.createdAt.toISOString(),
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await loadAuthorized(params.id, user.id, user.role);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  // Only drafts can have totals re-computed; once sent, edits are limited
  // to status changes (e.g. mark accepted).
  if (res.quotation.status !== "draft" && parsed.data.lineItems) {
    return NextResponse.json({ error: "Cannot edit line items on a sent quotation" }, { status: 422 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.customerName !== undefined) data.customerName = parsed.data.customerName;
  if (parsed.data.lengthFt !== undefined) data.lengthFt = parsed.data.lengthFt;
  if (parsed.data.widthFt !== undefined) data.widthFt = parsed.data.widthFt;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
  if (parsed.data.validityDays !== undefined) data.validityDays = parsed.data.validityDays;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;
  if (parsed.data.contactPhone !== undefined) data.contactPhone = parsed.data.contactPhone;
  if (parsed.data.lineItems) {
    const totals = recompute(parsed.data.lineItems as QuoteLineItem[]);
    data.lineItems = JSON.stringify(parsed.data.lineItems);
    data.subtotal = totals.subtotal;
    data.gstAmount = totals.gstAmount;
    data.grandTotal = totals.grandTotal;
    // Clear cached PDF — must regenerate after edits
    data.pdfUrl = null;
  }

  const updated = await prisma.quotation.update({ where: { id: params.id }, data });

  // Resync DealLineItem — POST /api/quotations creates these but until now
  // nothing ever refreshed them on a line-item edit, so they'd carry the
  // ORIGINAL rate/label/amount forever even after a draft was corrected —
  // silently wrong "won"/product-movement analytics the moment this deal
  // closes. No live caller sends lineItems via PATCH today (confirmed
  // during the 2026-07-16 sweep), but the Zod schema accepted it and the
  // gap was real, so fixed rather than left for whichever future feature
  // exercises this path. Delete-then-recreate (not a diff) mirrors the
  // POST route's own creation logic exactly — same fields, same
  // included-only filter, same best-effort/never-fails-the-request rule.
  if (parsed.data.lineItems && res.quotation.dealId) {
    try {
      const sport = await prisma.sport.findUnique({ where: { slug: res.quotation.sport } });
      await prisma.dealLineItem.deleteMany({ where: { quotationId: params.id } });
      const included = (parsed.data.lineItems as QuoteLineItem[]).filter((li) => li.included);
      if (included.length) {
        await prisma.dealLineItem.createMany({
          data: included.map((li) => ({
            dealId: res.quotation.dealId!,
            quotationId: params.id,
            productId: li.productId ?? null,
            sportId: sport?.id ?? null,
            label: li.name,
            quantity: li.areaSqFt,
            unit: li.unit ?? null,
            rate: li.ratePerSqFt,
            amount: li.total,
            isEnquiryOnly: false,
          })),
        });
      }
    } catch (err) {
      console.error("[quotations] DealLineItem resync failed", err);
    }

    // Keep Deal.quotedValue current too — same reasoning as POST's own
    // unconditional sync (docs/DECISIONS.md), only when this IS the deal's
    // primary revision (editing an old, already-superseded draft shouldn't
    // override what a newer quote already set).
    if (res.quotation.isPrimary) {
      const dealAfterEdit = await prisma.deal
        .update({ where: { id: res.quotation.dealId }, data: { quotedValue: updated.grandTotal } })
        .catch(() => null);
      if (dealAfterEdit?.conversationId) {
        await prisma.conversation
          .update({
            where: { id: dealAfterEdit.conversationId },
            data: { dealValue: dealAfterEdit.wonValue ?? dealAfterEdit.quotedValue },
          })
          .catch(() => null);
      }
    }
  }

  return NextResponse.json({ ok: true, status: updated.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    const deleted = await prisma.quotation.delete({ where: { id: params.id } });
    // If this was the deal's primary revision, promote the next-most-recent
    // remaining one and keep Deal.quotedValue in sync — see docs/DECISIONS.md.
    await reconcileDealAfterQuotationDelete(deleted.dealId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
