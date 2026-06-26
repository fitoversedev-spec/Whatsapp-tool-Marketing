// Quotation list + create. Create is fed by the wizard's Step 2 submit —
// it freezes the line items (description, area, rate, GST) into a JSON
// snapshot on the row so the historical record stays accurate even when
// the rate sheet changes later.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildQuotationNumber, recompute, type QuoteLineItem } from "@/lib/quotation/calculator";

const lineItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  description: z.string().max(4000),
  areaSqFt: z.number().min(0).max(1_000_000),
  ratePerSqFt: z.number().min(0).max(1_000_000),
  gstPercent: z.number().min(0).max(100),
  total: z.number().min(0),
  included: z.boolean(),
});

const createSchema = z.object({
  customerName: z.string().min(1).max(200),
  sport: z.string().default("football"),
  lengthFt: z.number().int().min(1).max(10_000),
  widthFt: z.number().int().min(1).max(10_000),
  lineItems: z.array(lineItemSchema).min(1),
  notes: z.string().max(4000).optional(),
  quoteDate: z.string().datetime(),
  validityDays: z.number().int().min(1).max(365).default(30),
  conversationId: z.string().uuid().nullable().optional(),
  contactPhone: z.string().min(5).max(30).nullable().optional(),
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

  // Generate sequential number per year.
  const year = new Date(parsed.data.quoteDate).getFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const endOfYear = new Date(Date.UTC(year + 1, 0, 1));
  const countThisYear = await prisma.quotation.count({
    where: { createdAt: { gte: startOfYear, lt: endOfYear } },
  });
  const number = buildQuotationNumber(year, countThisYear);

  const quotation = await prisma.quotation.create({
    data: {
      number,
      customerName: parsed.data.customerName,
      sport: parsed.data.sport,
      lengthFt: parsed.data.lengthFt,
      widthFt: parsed.data.widthFt,
      lineItems: JSON.stringify(parsed.data.lineItems),
      subtotal: totals.subtotal,
      gstAmount: totals.gstAmount,
      grandTotal: totals.grandTotal,
      notes: parsed.data.notes ?? null,
      quoteDate: new Date(parsed.data.quoteDate),
      validityDays: parsed.data.validityDays,
      conversationId: parsed.data.conversationId ?? null,
      contactPhone: parsed.data.contactPhone ?? null,
      createdByUserId: user.id,
      status: "draft",
    },
  });

  return NextResponse.json({
    quotation: {
      id: quotation.id,
      number: quotation.number,
      status: quotation.status,
      grandTotal: quotation.grandTotal.toString(),
    },
  });
}
