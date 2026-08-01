// Record / list payments against an invoice. Adding a payment recomputes the
// invoice's amountPaid + status (issued/sent → partially_paid → paid) in one
// transaction. Owner-or-admin.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recomputeInvoiceStatus } from "@/lib/invoice/status";

async function loadAuthorized(id: string, userId: string, role: string) {
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { id: true, createdByUserId: true, status: true } });
  if (!inv) return { error: "not_found" as const, status: 404 };
  if (role !== "admin" && inv.createdByUserId !== userId) return { error: "forbidden" as const, status: 403 };
  return { invoice: inv };
}

const createSchema = z.object({
  amount: z.number().positive().max(100_000_000),
  paidAt: z.string().datetime().optional(),
  method: z.enum(["cash", "upi", "bank", "cheque", "other"]).optional(),
  reference: z.string().max(200).optional(),
  note: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await loadAuthorized(params.id, user.id, user.role);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  if (res.invoice.status === "cancelled") {
    return NextResponse.json({ error: "Cannot record a payment on a cancelled invoice" }, { status: 422 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    await tx.invoicePayment.create({
      data: {
        invoiceId: params.id,
        amount: parsed.data.amount,
        paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date(),
        method: parsed.data.method ?? null,
        reference: parsed.data.reference ?? null,
        note: parsed.data.note ?? null,
        recordedByUserId: user.id,
      },
    });
    await recomputeInvoiceStatus(params.id, tx);
  });

  const inv = await prisma.invoice.findUnique({ where: { id: params.id }, select: { status: true, amountPaid: true } });
  return NextResponse.json({ ok: true, status: inv?.status, amountPaid: inv?.amountPaid.toString() });
}
