// Invoice analytics — read side for the "Invoices" tab in CRM Analytics and the
// AI analytics toolbox. Reads Invoice + InvoicePayment. The admin Invoices tab
// reads company-wide; the AI toolbox passes ownerIds to scope a non-admin rep to
// invoices THEY created, so the AI never leaks other reps' collections.
// Cancelled invoices are excluded from every figure. Amounts in rupees; months
// bucketed in IST.
//
// Two different "collected" definitions, intentionally: the KPI `collected` and
// `collectionRate` are a COHORT measure — total paid to date on invoices ISSUED
// in the window (Invoice.amountPaid, by invoice date), which is what makes a
// collection RATE meaningful. The monthly `collected` series is cash RECEIVED in
// the window (InvoicePayment.paidAt, by payment date). The UI labels the monthly
// series "received" so the two aren't read as the same number.

import { prisma } from "@/lib/prisma";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istMonthKey(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type InvoiceKpis = {
  invoicedValue: number;
  invoiceCount: number;
  collected: number;
  outstanding: number;
  overdue: number;
  collectionRate: number | null;
  avgDaysToPay: number | null;
};
export type InvoiceRepRow = {
  userId: string;
  userName: string;
  invoiceCount: number;
  invoicedValue: number;
  collected: number;
  outstanding: number;
  overdueAmount: number;
  collectionRate: number | null;
};
export type InvoiceMonthly = { month: string; invoiced: number; collected: number };
export type InvoiceAnalytics = { kpis: InvoiceKpis; reps: InvoiceRepRow[]; monthly: InvoiceMonthly[] };

export async function getInvoiceAnalytics({ from, to, ownerIds }: { from: Date; to: Date; ownerIds?: string[] }): Promise<InvoiceAnalytics> {
  // ownerIds present -> restrict to invoices created by those reps (AI rep scope);
  // an empty array matches nothing (fails closed). Absent -> company-wide.
  const ownerWhere = ownerIds ? { createdByUserId: { in: ownerIds } } : {};
  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: { invoiceDate: { gte: from, lte: to }, status: { not: "cancelled" }, ...ownerWhere },
      select: {
        createdByUserId: true,
        grandTotal: true,
        amountPaid: true,
        status: true,
        invoiceDate: true,
        dueDate: true,
        paidAt: true,
        createdBy: { select: { name: true } },
      },
    }),
    prisma.invoicePayment.findMany({
      where: { paidAt: { gte: from, lte: to }, invoice: { status: { not: "cancelled" }, ...ownerWhere } },
      select: { amount: true, paidAt: true },
    }),
  ]);

  const now = new Date();
  let invoicedValue = 0;
  let collected = 0;
  let outstanding = 0;
  let overdue = 0;
  let daysToPaySum = 0;
  let paidCount = 0;

  const repMap = new Map<string, InvoiceRepRow>();
  const monthMap = new Map<string, { invoiced: number; collected: number }>();

  for (const inv of invoices) {
    const total = Number(inv.grandTotal);
    const paid = Number(inv.amountPaid);
    const due = Math.max(0, total - paid);
    invoicedValue += total;
    collected += paid;
    outstanding += due;
    // Overdue = any still-owed balance past its due date — derived from dueDate,
    // NOT the "overdue" status bucket, since a partially-paid past-due invoice
    // carries status "partially_paid" and would otherwise be invisible here.
    // This keeps Overdue a true subset of Outstanding.
    if (due > 0.005 && inv.dueDate < now) overdue += due;
    if (inv.status === "paid" && inv.paidAt) {
      daysToPaySum += Math.max(0, (inv.paidAt.getTime() - inv.invoiceDate.getTime()) / 86_400_000);
      paidCount += 1;
    }

    const rep = repMap.get(inv.createdByUserId) ?? {
      userId: inv.createdByUserId,
      userName: inv.createdBy.name,
      invoiceCount: 0,
      invoicedValue: 0,
      collected: 0,
      outstanding: 0,
      overdueAmount: 0,
      collectionRate: null,
    };
    rep.invoiceCount += 1;
    rep.invoicedValue += total;
    rep.collected += paid;
    rep.outstanding += due;
    if (due > 0.005 && inv.dueDate < now) rep.overdueAmount += due;
    repMap.set(inv.createdByUserId, rep);

    const mk = istMonthKey(inv.invoiceDate);
    const m = monthMap.get(mk) ?? { invoiced: 0, collected: 0 };
    m.invoiced += total;
    monthMap.set(mk, m);
  }

  for (const p of payments) {
    const mk = istMonthKey(p.paidAt);
    const m = monthMap.get(mk) ?? { invoiced: 0, collected: 0 };
    m.collected += Number(p.amount);
    monthMap.set(mk, m);
  }

  const reps = [...repMap.values()]
    .map((r) => ({ ...r, collectionRate: r.invoicedValue > 0 ? r.collected / r.invoicedValue : null }))
    .sort((a, b) => b.invoicedValue - a.invoicedValue);

  const monthly = [...monthMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, invoiced: Math.round(v.invoiced), collected: Math.round(v.collected) }));

  return {
    kpis: {
      invoicedValue: Math.round(invoicedValue),
      invoiceCount: invoices.length,
      collected: Math.round(collected),
      outstanding: Math.round(outstanding),
      overdue: Math.round(overdue),
      collectionRate: invoicedValue > 0 ? collected / invoicedValue : null,
      avgDaysToPay: paidCount > 0 ? Math.round(daysToPaySum / paidCount) : null,
    },
    reps,
    monthly,
  };
}
