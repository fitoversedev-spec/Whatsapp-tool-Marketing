// Single invoice: GET detail (with payments), PATCH (notes / due date / cancel),
// DELETE (admin). Owner-or-admin, mirroring the quotation [id] route.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { QuoteLineItem } from "@/lib/quotation/calculator";

async function loadAuthorized(id: string, userId: string, role: string) {
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: { orderBy: { paidAt: "desc" }, include: { recordedBy: { select: { name: true } } } } },
  });
  if (!inv) return { error: "not_found" as const, status: 404 };
  if (role !== "admin" && inv.createdByUserId !== userId) return { error: "forbidden" as const, status: 403 };
  return { invoice: inv };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await loadAuthorized(params.id, user.id, user.role);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  const inv = res.invoice;

  return NextResponse.json({
    invoice: {
      id: inv.id,
      number: inv.number,
      quotationId: inv.quotationId,
      dealId: inv.dealId,
      customerName: inv.customerName,
      contactPhone: inv.contactPhone,
      billingAddress: inv.billingAddress,
      sport: inv.sport,
      lineItems: JSON.parse(inv.lineItems) as QuoteLineItem[],
      subtotal: inv.subtotal.toString(),
      gstAmount: inv.gstAmount.toString(),
      grandTotal: inv.grandTotal.toString(),
      amountPaid: inv.amountPaid.toString(),
      status: inv.status,
      invoiceDate: inv.invoiceDate.toISOString(),
      dueDate: inv.dueDate.toISOString(),
      sentAt: inv.sentAt?.toISOString() ?? null,
      paidAt: inv.paidAt?.toISOString() ?? null,
      notes: inv.notes,
      pdfUrl: inv.pdfUrl,
      createdAt: inv.createdAt.toISOString(),
      payments: inv.payments.map((p) => ({
        id: p.id,
        amount: p.amount.toString(),
        paidAt: p.paidAt.toISOString(),
        method: p.method,
        reference: p.reference,
        note: p.note,
        recordedByName: p.recordedBy.name,
      })),
    },
  });
}

const patchSchema = z.object({
  notes: z.string().max(4000).nullable().optional(),
  dueDate: z.string().datetime().optional(),
  billingAddress: z.string().max(1000).nullable().optional(),
  status: z.enum(["cancelled"]).optional(), // only cancel via PATCH; other statuses are payment-derived
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await loadAuthorized(params.id, user.id, user.role);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
  if (parsed.data.billingAddress !== undefined) data.billingAddress = parsed.data.billingAddress;
  if (parsed.data.dueDate !== undefined) {
    data.dueDate = new Date(parsed.data.dueDate);
    data.pdfUrl = null; // due date shows on the PDF — force a re-render
  }
  if (parsed.data.status === "cancelled") data.status = "cancelled";

  const updated = await prisma.invoice.update({ where: { id: params.id }, data });
  return NextResponse.json({ ok: true, status: updated.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  try {
    await prisma.invoice.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
