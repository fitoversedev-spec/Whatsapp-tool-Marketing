// Convert a (confirmed) quotation into an invoice — one invoice per quote.
// Snapshots the quote's line items + totals, names it "<Customer>.inv (<Sport>)",
// and marks the quote accepted (stamping acceptedAt, which the PATCH route
// never did). It doesn't touch deals: a deal is a confirmed project, created
// only with "Won" on the customer.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextInvoiceNumber } from "@/lib/invoice/number";

export const runtime = "nodejs";

// Net payment terms — invoice due this many days after issue.
const DEFAULT_TERMS_DAYS = 15;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const quote = await prisma.quotation.findUnique({
    where: { id: params.id },
    include: { deal: { select: { id: true, siteAddress: true } } },
  });
  if (!quote) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && quote.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // One invoice per quote.
  const existing = await prisma.invoice.findUnique({ where: { quotationId: quote.id }, select: { id: true, number: true } });
  if (existing) {
    return NextResponse.json({ error: "invoice_exists", invoice: existing }, { status: 409 });
  }

  // Mark the quote accepted (customer confirmed) — stamp acceptedAt if unset.
  await prisma.quotation
    .update({
      where: { id: quote.id },
      data: { status: "accepted", acceptedAt: quote.acceptedAt ?? new Date() },
    })
    .catch(() => null);

  const now = new Date();
  const dueDate = new Date(now.getTime() + DEFAULT_TERMS_DAYS * 24 * 60 * 60 * 1000);

  // Create the invoice, retrying the customer-name numbering on a genuine
  // unique-collision race (mirrors the quote route's P2002 retry).
  let invoice = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const number = await nextInvoiceNumber(quote.customerName, quote.sport);
    try {
      invoice = await prisma.invoice.create({
        data: {
          number,
          quotationId: quote.id,
          dealId: quote.dealId,
          customerName: quote.customerName,
          contactPhone: quote.contactPhone,
          billingAddress: quote.deal?.siteAddress ?? null,
          sport: quote.sport,
          lineItems: quote.lineItems, // verbatim JSON snapshot
          subtotal: quote.subtotal,
          gstAmount: quote.gstAmount,
          grandTotal: quote.grandTotal,
          gstMode: quote.gstMode,
          invoiceDate: now,
          dueDate,
          status: "issued",
          createdByUserId: user.id,
        },
      });
      break;
    } catch (err) {
      lastError = err;
      const e = err as { code?: string; meta?: { target?: string[] | string } };
      if (e?.code !== "P2002") throw err;
      // Invoice has TWO unique columns: `number` and `quotationId`. Regenerating
      // the number only helps a `number` collision. A `quotationId` collision
      // means a concurrent request already created this quote's invoice — return
      // 409 with it instead of burning all 6 retries into a misleading 503.
      const t = e.meta?.target;
      const onQuotationId = Array.isArray(t) ? t.some((x) => x.includes("quotation")) : typeof t === "string" && t.includes("quotation");
      if (onQuotationId) {
        const existingNow = await prisma.invoice.findUnique({ where: { quotationId: quote.id }, select: { id: true, number: true } });
        return NextResponse.json({ error: "invoice_exists", invoice: existingNow }, { status: 409 });
      }
      // else: genuine `number` collision — loop and retry with a fresh number.
    }
  }
  if (!invoice) {
    console.error("[invoice/convert] number collision after retries", lastError);
    return NextResponse.json({ error: "Could not assign a unique invoice number. Try again." }, { status: 503 });
  }

  return NextResponse.json({ invoice: { id: invoice.id, number: invoice.number, status: invoice.status } });
}
