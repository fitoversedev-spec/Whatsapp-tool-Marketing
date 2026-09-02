// Quotation list + create. Create is fed by the wizard's Step 2 submit —
// it freezes the line items (description, area, rate, GST) into a JSON
// snapshot on the row so the historical record stays accurate even when
// the rate sheet changes later.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildQuotationNumber, recompute, lineItemSchema, type QuoteLineItem } from "@/lib/quotation/calculator";
import { findOrCreateDealForConversation, reconcileDealAfterQuotationDelete } from "@/lib/crm/deals";

const createSchema = z.object({
  customerName: z.string().min(1).max(200),
  // The project's location, not stored on Quotation itself — written
  // through to Deal.siteCity, which Team Performance's Geography view reads.
  siteCity: z.string().max(100).optional(),
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
  // Tier-1 classification — written to Deal.leadSourceId / Account.customerProfileId
  // / Account.businessType, which Team Performance's Sources and Customers
  // views read (previously always empty — see docs/DECISIONS.md).
  leadSourceId: z.string().uuid().nullable().optional(),
  customerProfileId: z.string().uuid().nullable().optional(),
  businessType: z.enum(["B2B", "B2C", "B2G"]).nullable().optional(),
  salespersonPhone: z.string().max(30).nullable().optional(),
  sections: z.string().max(100_000).refine((s) => { try { JSON.parse(s); return true; } catch { return false; } }, "sections must be valid JSON").optional(),
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

  // Select only the columns the list needs — skips the large lineItems JSON
  // blob (~2-10 KB per row × 200 rows) for a much faster query + response.
  const items = await prisma.quotation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      number: true,
      customerName: true,
      sport: true,
      lengthFt: true,
      widthFt: true,
      grandTotal: true,
      status: true,
      pdfUrl: true,
      quoteDate: true,
      validityDays: true,
      sentAt: true,
      contactPhone: true,
      conversationId: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
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

  // Resolve the Deal this quote attaches to: an explicit dealId if the
  // caller already knows it, otherwise find-or-create by conversationId
  // (reusing an existing Deal so a second/revised quote for the same
  // customer lands on the SAME deal instead of spawning a duplicate — see
  // docs/DECISIONS.md, this used to unconditionally create a new Deal every
  // time). conversationId itself may be null (a genuinely standalone quote),
  // which the helper handles by always creating fresh.
  let dealId = parsed.data.dealId ?? null;
  if (!dealId) {
    const resolved = await findOrCreateDealForConversation({
      conversationId: parsed.data.conversationId ?? null,
      accountName: parsed.data.customerName,
      dealTitle: `Quote for ${parsed.data.customerName}`,
      ownerUserId: user.id,
      leadSourceId: parsed.data.leadSourceId,
      customerProfileId: parsed.data.customerProfileId,
      businessType: parsed.data.businessType,
    });
    dealId = resolved.id;
  }
  // Run independent writes in parallel: deal update, isPrimary demotion, sequence number lookup.
  const [dealAfterQuote, , nextSeqResult] = await Promise.all([
    prisma.deal
      .update({
        where: { id: dealId },
        data: {
          quotedValue: totals.grandTotal,
          ...(parsed.data.siteCity ? { siteCity: parsed.data.siteCity } : {}),
          ...(parsed.data.leadSourceId ? { leadSourceId: parsed.data.leadSourceId } : {}),
        },
      })
      .catch(() => null),
    prisma.quotation.updateMany({ where: { dealId, isPrimary: true }, data: { isPrimary: false } }),
    nextSequenceForYear(year),
  ]);

  // Conversation + Account syncs (depend on dealAfterQuote, but independent of each other).
  const sideEffects: Promise<unknown>[] = [];
  if (dealAfterQuote?.conversationId) {
    sideEffects.push(
      prisma.conversation
        .update({
          where: { id: dealAfterQuote.conversationId },
          data: { dealValue: dealAfterQuote.wonValue ?? dealAfterQuote.quotedValue },
        })
        .catch(() => null),
    );
  }
  if (parsed.data.dealId && (parsed.data.customerProfileId || parsed.data.businessType)) {
    sideEffects.push(
      prisma.deal
        .findUnique({ where: { id: dealId }, select: { accountId: true } })
        .then((d) =>
          d
            ? prisma.account
                .update({
                  where: { id: d.accountId },
                  data: {
                    ...(parsed.data.customerProfileId ? { customerProfileId: parsed.data.customerProfileId } : {}),
                    ...(parsed.data.businessType ? { businessType: parsed.data.businessType } : {}),
                  },
                })
                .catch(() => null)
            : null,
        ),
    );
  }
  // Fire-and-forget — these syncs don't affect the quote itself.
  if (sideEffects.length) Promise.all(sideEffects).catch(() => {});

  let quotation;
  let lastError: unknown = null;
  let nextSeq = nextSeqResult;
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
          salespersonPhone: parsed.data.salespersonPhone ?? null,
          sections: parsed.data.sections ?? null,
          createdByUserId: user.id,
          status: "draft",
          dealId,
          isPrimary: true,
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

  // Fire-and-forget — DealLineItem rows for analytics. The quote's own JSON
  // snapshot is already saved; this best-effort write must never delay the response.
  if (dealId) {
    (async () => {
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
    })();
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

  // Collect affected deals BEFORE deleteMany (which doesn't return row data)
  // so each can be reconciled afterward — see docs/DECISIONS.md.
  const affected = await prisma.quotation.findMany({
    where: { id: { in: parsed.data.ids } },
    select: { dealId: true },
  });
  const dealIds = [...new Set(affected.map((q) => q.dealId).filter((id): id is string => !!id))];

  const result = await prisma.quotation.deleteMany({
    where: { id: { in: parsed.data.ids } },
  });
  await Promise.all(dealIds.map((id) => reconcileDealAfterQuotationDelete(id)));
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
