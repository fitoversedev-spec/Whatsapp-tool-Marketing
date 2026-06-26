import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recompute, type QuoteLineItem } from "@/lib/quotation/calculator";

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

const patchSchema = z.object({
  customerName: z.string().min(1).max(200).optional(),
  lengthFt: z.number().int().min(1).max(10_000).optional(),
  widthFt: z.number().int().min(1).max(10_000).optional(),
  lineItems: z.array(lineItemSchema).optional(),
  notes: z.string().max(4000).optional(),
  validityDays: z.number().int().min(1).max(365).optional(),
  status: z.enum(["draft", "sent", "viewed", "accepted", "expired"]).optional(),
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
  return NextResponse.json({ ok: true, status: updated.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    await prisma.quotation.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
