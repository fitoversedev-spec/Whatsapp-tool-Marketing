// Ensure an invoice has a rendered PDF in Blob storage, returning its URL.
// Shared by the send route and the public /inv/[id] link so the PDF renders
// once and both reuse the cached pdfUrl.

import { prisma } from "@/lib/prisma";
import { renderInvoicePdf } from "./pdf";
import { sportLabel } from "./number";
import { uploadToBlob } from "@/lib/media";
import type { QuoteLineItem } from "@/lib/quotation/calculator";

export function invoiceFileName(number: string): string {
  return `${number.replace(/[^a-zA-Z0-9]+/g, "-")}.pdf`;
}

export async function ensureInvoicePdfUrl(invoiceId: string): Promise<string | null> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return null;
  if (inv.pdfUrl) return inv.pdfUrl;

  const lineItems = JSON.parse(inv.lineItems) as QuoteLineItem[];
  const bytes = await renderInvoicePdf({
    number: inv.number,
    customerName: inv.customerName,
    contactPhone: inv.contactPhone,
    billingAddress: inv.billingAddress,
    sportLabel: await sportLabel(inv.sport),
    lineItems,
    subtotal: Number(inv.subtotal),
    gstAmount: Number(inv.gstAmount),
    grandTotal: Number(inv.grandTotal),
    amountPaid: Number(inv.amountPaid),
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    notes: inv.notes,
  });
  const uploaded = await uploadToBlob({
    bytes: Buffer.from(bytes),
    fileName: invoiceFileName(inv.number),
    mimeType: "application/pdf",
    folder: "invoices",
  });
  await prisma.invoice.update({ where: { id: invoiceId }, data: { pdfUrl: uploaded.url } });
  return uploaded.url;
}
