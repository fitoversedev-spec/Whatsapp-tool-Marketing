// Quotation list + create. Create is fed by the wizard's Step 2 submit —
// it freezes the line items (description, area, rate, GST) into a JSON
// snapshot on the row so the historical record stays accurate even when
// the rate sheet changes later.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildQuotationNumber, recompute, lineItemSchema, type QuoteLineItem } from "@/lib/quotation/calculator";
import { defaultFunnelStageId, buildDealCode, nextDealSequenceForYear } from "@/lib/crm/deals";

const createSchema = z.object({
  customerName: z.string().min(1).max(200),
  sport: z.string().default("football"),
  lengthFt: z.number().int().min(1).max(10_000),
  widthFt: z.number().int().min(1).max(10_000),
  lineItems: z.array(lineItemSchema).min(1),
  notes: z.string().max(4000).optional(),
  // Customer-facing caption — sent as a text message BEFORE the PDF
  // during /send so WhatsApp displays it clearly.
  caption: z.string().max(1024).nullable().optional(),
  quoteDate: z.string().datetime(),
  validityDays: z.number().int().min(1).max(365).default(30),
  conversationId: z.string().uuid().nullable().optional(),
  contactPhone: z.string().min(5).max(30).nullable().optional(),
  // Phase 2 — attach to an existing Deal. Omitted = the route auto-creates
  // a one-off Deal so dealId always ends up populated without forcing a
  // deal-first flow in the wizard (see docs/DECISIONS.md).
  dealId: z.string().uuid().nullable().optional(),
});

const listFilterSchema = z.object({
  status: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  search: z.string().optional(),
  createdByUserId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const filters = listFilterSchema.safeParse({
    status: sp.get("status") ?? undefined,
    fromDate: sp.get("fromDate") ?? undefined,
    toDate: sp.get("toDate") ?? undefined,
    search: sp.get("search") ?? undefined,
    createdByUserId: sp.get("createdByUserId") ?? undefined,
  });
  const f = filters.success ? filters.data : {};

  const where: Record<string, unknown> = {};
  if (f.status) where.status = f.status;
  if (f.createdByUserId) where.createdByUserId = f.createdByUserId;
  if (f.fromDate || f.toDate) {
    where.createdAt = {
      ...(f.fromDate && { gte: new Date(f.fromDate) }),
      ...(f.toDate && { lte: new Date(f.toDate) }),
    };
  }
  if (f.search) {
    const s = f.search.trim();
    where.OR = [
      { customerName: { contains: s, mode: "insensitive" } },
      { number: { contains: s, mode: "insensitive" } },
      { contactPhone: { contains: s } },
    ];
  }

  // Sales sees only their own; admin sees all.
  if (user.role !== "admin") {
    where.createdByUserId = user.id;
  }

  const items = await prisma.quotation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { createdBy: { select: { name: true } } },
  });

  return NextResponse.json({
    quotations: items.map((q) => ({
      id: q.id,
      number: q.number,
      customerName: q.customerName,
      sport: q.sport,
      lengthFt: q.lengthFt,
      widthFt: q.widthFt,
      grandTotal: q.grandTotal.toString(),
      status: q.status,
      pdfUrl: q.pdfUrl,
      quoteDate: q.quoteDate.toISOString(),
      validityDays: q.validityDays,
      sentAt: q.sentAt?.toISOString() ?? null,
      contactPhone: q.contactPhone,
      conversationId: q.conversationId,
      createdByName: q.createdBy.name,
      createdAt: q.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  // Compute totals server-side from the line items (don't trust client math).
  const totals = recompute(parsed.data.lineItems as QuoteLineItem[]);

  const year = new Date(parsed.data.quoteDate).getFullYear();

  // Phase 2 — resolve the Deal this quote attaches to. If none was given,
  // auto-create a standalone Account + Deal (same shape the backfill script
  // uses for orphan quotes) so dealId always ends up populated without
  // requiring a deal-first flow in the wizard. No duplicate-account check
  // here (unlike POST /api/deals) — this is a background convenience, not a
  // user-facing "create account" action; an admin can reconcile duplicates
  // later if a customer ends up with more than one from repeated standalone quotes.
  let dealId = parsed.data.dealId ?? null;
  if (!dealId) {
    const [stageId, dealSeq] = await Promise.all([defaultFunnelStageId(), nextDealSequenceForYear(year)]);
    const account = await prisma.account.create({
      data: { name: parsed.data.customerName, ownerUserId: user.id },
    });
    const deal = await prisma.deal.create({
      data: {
        code: buildDealCode(year, dealSeq - 1),
        title: `Quote for ${parsed.data.customerName}`,
        accountId: account.id,
        ownerUserId: user.id,
        currentStageId: stageId,
        conversationId: parsed.data.conversationId ?? null,
        quotedValue: totals.grandTotal,
      },
    });
    dealId = deal.id;
  }

  // Sequential quotation number per calendar year. Originally we just
  // used count() + 1, but that collides as soon as ANY row gets deleted
  // (count drops below the highest existing seq) or two users create at
  // the same time. Read the highest existing FIT-QT-YYYY-NNN for the
  // year and pick max + 1 instead — and if the unique constraint still
  // trips (genuine race), bump and retry.
  let quotation;
  let lastError: unknown = null;
  let nextSeq = await nextSequenceForYear(year);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      quotation = await prisma.quotation.create({
        data: {
          number: buildQuotationNumber(year, nextSeq - 1),
          customerName: parsed.data.customerName,
          sport: parsed.data.sport,
          lengthFt: parsed.data.lengthFt,
          widthFt: parsed.data.widthFt,
          lineItems: JSON.stringify(parsed.data.lineItems),
          subtotal: totals.subtotal,
          gstAmount: totals.gstAmount,
          grandTotal: totals.grandTotal,
          notes: parsed.data.notes ?? null,
          caption: parsed.data.caption ?? null,
          quoteDate: new Date(parsed.data.quoteDate),
          validityDays: parsed.data.validityDays,
          conversationId: parsed.data.conversationId ?? null,
          contactPhone: parsed.data.contactPhone ?? null,
          createdByUserId: user.id,
          status: "draft",
          dealId,
        },
      });
      break;
    } catch (err) {
      lastError = err;
      // P2002 = unique constraint failure. Only retry that one; bubble
      // everything else immediately so unrelated bugs aren't masked.
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") throw err;
      nextSeq += 1;
    }
  }

  if (!quotation) {
    console.error("[quotations] number collision after retries", lastError);
    return NextResponse.json(
      {
        error:
          "Could not assign a unique quote number after retries. Try again in a moment.",
      },
      { status: 503 }
    );
  }

  // Phase 2 — DealLineItem rows: a real (not enquiry-only) row per included
  // line item, so product-movement analytics can answer "what's sold" once
  // Phase 4 ships. Best-effort — a failure here must never fail quote
  // creation itself, since the quote's own JSON snapshot already saved fine.
  try {
    const sport = await prisma.sport.findUnique({ where: { slug: parsed.data.sport } });
    const included = parsed.data.lineItems.filter((li) => li.included);
    if (included.length) {
      await prisma.dealLineItem.createMany({
        data: included.map((li) => ({
          dealId: dealId!,
          quotationId: quotation!.id,
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
    console.error("[quotations] DealLineItem write failed", err);
  }

  return NextResponse.json({
    quotation: {
      id: quotation.id,
      number: quotation.number,
      status: quotation.status,
      grandTotal: quotation.grandTotal.toString(),
    },
  });
}

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

// Bulk delete — mirrors the single-item DELETE's admin-only rule exactly
// (src/app/api/quotations/[id]/route.ts).
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bulkDeleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const result = await prisma.quotation.deleteMany({
    where: { id: { in: parsed.data.ids } },
  });
  return NextResponse.json({ ok: true, count: result.count });
}

// Find the next sequential number for a given calendar year by parsing
// the highest existing FIT-QT-YYYY-NNN row. Returns 1 if no quotations
// exist yet that year.
async function nextSequenceForYear(year: number): Promise<number> {
  const prefix = `FIT-QT-${year}-`;
  const latest = await prisma.quotation.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  if (!latest) return 1;
  const seqStr = latest.number.slice(prefix.length);
  const seq = parseInt(seqStr, 10);
  if (!Number.isFinite(seq)) return 1;
  return seq + 1;
}
