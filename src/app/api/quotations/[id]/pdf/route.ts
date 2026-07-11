// Render a quotation as PDF. Returns the PDF bytes inline so the wizard's
// preview iframe can render it directly. Cached at pdfUrl on first send to
// avoid re-rendering on every preview load.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renderQuotationPdf } from "@/lib/quotation/pdf";
import type { QuoteLineItem } from "@/lib/quotation/calculator";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const q = await prisma.quotation.findUnique({ where: { id: params.id } });
  if (!q) return new NextResponse("not found", { status: 404 });
  if (user.role !== "admin" && q.createdByUserId !== user.id) {
    return new NextResponse("forbidden", { status: 403 });
  }

  let pdfBuffer: Buffer;
  try {
    const lineItems = JSON.parse(q.lineItems) as QuoteLineItem[];
    pdfBuffer = await renderQuotationPdf({
      number: q.number,
      customerName: q.customerName,
      sport: q.sport,
      lengthFt: q.lengthFt,
      widthFt: q.widthFt,
      lineItems,
      subtotal: Number(q.subtotal),
      gstAmount: Number(q.gstAmount),
      grandTotal: Number(q.grandTotal),
      notes: q.notes,
      quoteDate: q.quoteDate,
      validityDays: q.validityDays,
    });
  } catch (e) {
    // Surface the real error to the preview iframe instead of letting an
    // unhandled throw crash the Next.js worker ("Jest worker encountered child
    // process exceptions, exceeding retry limit").
    console.error("[quotation pdf] render failed for", q.number, e);
    return new NextResponse(
      "Failed to render quotation PDF: " +
        (e instanceof Error ? e.message : String(e)),
      { status: 500 },
    );
  }

  // Node Buffer isn't a valid BodyInit type — coerce to Uint8Array.
  const safeName = (q.customerName ?? "quote").replace(/[^a-zA-Z0-9]+/g, "-");
  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${q.number}-${safeName}.pdf"`,
      "Cache-Control": "private, no-cache",
    },
  });
}
