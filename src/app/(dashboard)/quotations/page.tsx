import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import QuotationsClient from "./QuotationsClient";

export default async function QuotationsPage() {
  const user = await requireUser();

  const where = user.role === "admin" ? {} : { createdByUserId: user.id };

  const quotations = await prisma.quotation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { createdBy: { select: { name: true } } },
  });

  const salesUsers =
    user.role === "admin"
      ? await prisma.user.findMany({
          where: { role: { in: ["admin", "sales"] }, isActive: true, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];

  return (
    <QuotationsClient
      isAdmin={user.role === "admin"}
      initialQuotations={quotations.map((q) => ({
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
        createdByName: q.createdBy.name,
        createdAt: q.createdAt.toISOString(),
      }))}
      salesUsers={salesUsers}
    />
  );
}
