// Render a quotation as PDF. Returns the PDF bytes inline so the wizard's
// preview iframe can render it directly. Cached at pdfUrl on first send to
// avoid re-rendering on every preview load.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renderQuotationPdf } from "@/lib/quotation/pdf";
import type { QuoteLineItem } from "@/lib/quotation/calculator";
import { uploadToBlob } from "@/lib/media";

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

  const safeName = `${q.number}-${(q.customerName ?? "quote").replace(/[^a-zA-Z0-9]+/g, "-")}.pdf`;
  const pdfHeaders = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${safeName}"`,
    // A quote is an immutable snapshot (editing creates a NEW draft id), so its
    // PDF never changes — the browser can safely cache it for this id.
    "Cache-Control": "private, max-age=300",
  };

  // Cache HIT: reuse the already-rendered PDF instead of re-rendering on every
  // preview load / reload / send. Quotes are immutable so this is always valid.
  if (q.pdfUrl) {
    try {
      const cached = await fetch(q.pdfUrl);
      if (cached.ok) {
        return new NextResponse(new Uint8Array(await cached.arrayBuffer()), { headers: pdfHeaders });
      }
    } catch {
      // fall through and re-render
    }
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

  // Cache for next time — best-effort; a cache-write failure must never fail
  // the response. Persists pdfUrl so future loads (and /send) skip the render.
  try {
    const uploaded = await uploadToBlob({
      bytes: Buffer.from(pdfBuffer),
      fileName: safeName,
      mimeType: "application/pdf",
      folder: "quotations",
    });
    await prisma.quotation.update({ where: { id: q.id }, data: { pdfUrl: uploaded.url } });
  } catch (e) {
    console.error("[quotation pdf] cache upload failed for", q.number, e);
  }

  // Node Buffer isn't a valid BodyInit type — coerce to Uint8Array.
  return new NextResponse(new Uint8Array(pdfBuffer), { headers: pdfHeaders });
}
