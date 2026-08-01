// Delete a payment (correction) and recompute the invoice status. Owner-or-admin.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recomputeInvoiceStatus } from "@/lib/invoice/status";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; paymentId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const inv = await prisma.invoice.findUnique({ where: { id: params.id }, select: { createdByUserId: true } });
  if (!inv) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && inv.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoicePayment.deleteMany({ where: { id: params.paymentId, invoiceId: params.id } });
    await recomputeInvoiceStatus(params.id, tx);
  });

  return NextResponse.json({ ok: true });
}
