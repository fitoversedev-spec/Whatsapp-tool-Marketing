import type { Prisma } from "@prisma/client";

// Columns the quotation lists show. Leaves out lineItems / sections / notes
// (large JSON-ish blobs) so 200-row lists stay small and fast.
export const QUOTATION_LIST_SELECT = {
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
} satisfies Prisma.QuotationSelect;
