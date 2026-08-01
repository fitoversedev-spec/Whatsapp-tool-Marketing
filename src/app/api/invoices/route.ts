// Invoice list. Owner-scoped exactly like /api/quotations: a sales rep sees
// only invoices they created; admin sees all. Invoices are created via
// /api/quotations/[id]/convert-to-invoice, not here.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const filterSchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
  createdByUserId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const f = filterSchema.safeParse({
    status: sp.get("status") ?? undefined,
    search: sp.get("search") ?? undefined,
    createdByUserId: sp.get("createdByUserId") ?? undefined,
  });
  const filters = f.success ? f.data : {};

  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.createdByUserId) where.createdByUserId = filters.createdByUserId;
  if (filters.search) {
    const s = filters.search.trim();
    where.OR = [
      { number: { contains: s, mode: "insensitive" } },
      { customerName: { contains: s, mode: "insensitive" } },
      { contactPhone: { contains: s } },
    ];
  }
  // Sales sees only their own; admin sees all.
  if (user.role !== "admin") where.createdByUserId = user.id;

  const items = await prisma.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { createdBy: { select: { name: true } } },
  });

  return NextResponse.json({
    invoices: items.map((inv) => ({
      id: inv.id,
      number: inv.number,
      customerName: inv.customerName,
      sport: inv.sport,
      grandTotal: inv.grandTotal.toString(),
      amountPaid: inv.amountPaid.toString(),
      status: inv.status,
      invoiceDate: inv.invoiceDate.toISOString(),
      dueDate: inv.dueDate.toISOString(),
      contactPhone: inv.contactPhone,
      pdfUrl: inv.pdfUrl,
      createdByName: inv.createdBy.name,
      createdAt: inv.createdAt.toISOString(),
    })),
  });
}
