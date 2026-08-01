// Invoice payment-status derivation. The single source of truth for how
// amountPaid + dueDate map to a status, used by the payments routes (after a
// payment is added/removed) and by markOverdueInvoices() in the cron sweep.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type InvoiceStatus = "issued" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled";

// Pure mapping. `wasSent` preserves the sent/issued distinction for an unpaid,
// not-yet-overdue invoice.
export function deriveStatus(args: {
  grandTotal: number;
  amountPaid: number;
  dueDate: Date;
  now: Date;
  cancelled: boolean;
  wasSent: boolean;
}): InvoiceStatus {
  if (args.cancelled) return "cancelled";
  if (args.amountPaid >= args.grandTotal - 0.005) return "paid";
  if (args.amountPaid > 0) return "partially_paid";
  if (args.now > args.dueDate) return "overdue";
  return args.wasSent ? "sent" : "issued";
}

// Recompute amountPaid + status + paidAt for one invoice from its payment rows
// and persist them. Called inside a transaction after a payment change.
export async function recomputeInvoiceStatus(invoiceId: string, tx: Prisma.TransactionClient = prisma): Promise<void> {
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return;
  if (inv.status === "cancelled") return;

  const agg = await tx.invoicePayment.aggregate({ where: { invoiceId }, _sum: { amount: true }, _max: { paidAt: true } });
  const amountPaid = Number(agg._sum.amount ?? 0);
  const grandTotal = Number(inv.grandTotal);
  const wasSent = inv.status === "sent" || inv.sentAt != null;
  const status = deriveStatus({ grandTotal, amountPaid, dueDate: inv.dueDate, now: new Date(), cancelled: false, wasSent });

  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid,
      status,
      paidAt: status === "paid" ? agg._max.paidAt ?? new Date() : null,
    },
  });
}
