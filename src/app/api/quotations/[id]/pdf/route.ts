// Render a quotation as PDF. Returns the PDF bytes inline so the wizard's
// preview iframe can render it directly. The rendered PDF is saved to Blob under
// a fingerprint of everything drawn on it (see lib/quotation/pdf-cache.ts), so a
// reload reuses it and an edit to the quote rebuilds it.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { after } from "@/lib/scout/after";
import type { QuotationPdfData } from "@/lib/quotation/pdf";
import {
  buildQuotationPdfInputs,
  pdfKey,
  quotationFileName,
  renderQuotationPdfBytes,
  saveQuotationPdf,
  urlHasKey,
} from "@/lib/quotation/pdf-cache";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Does an If-None-Match header (a list, possibly weak "W/" tags, or "*") name this key? */
function etagMatches(header: string | null, key: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .some((t) => t === "*" || t === `"${key}"`);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const q = await prisma.quotation.findUnique({
    where: { id: params.id },
    include: { deal: { select: { siteCity: true } } },
  });
  if (!q) return new NextResponse("not found", { status: 404 });
  if (user.role !== "admin" && q.createdByUserId !== user.id) {
    return new NextResponse("forbidden", { status: 403 });
  }

  let inputs: QuotationPdfData;
  let key: string;
  try {
    inputs = await buildQuotationPdfInputs(q);
    key = pdfKey(inputs);
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

  // The key names the exact content, so it is the ETag: a reload revalidates
  // cheaply (304) and an edit changes the key, so it never shows an old PDF.
  const cacheHeaders = { ETag: `"${key}"`, "Cache-Control": "private, no-cache" };
  if (etagMatches(req.headers.get("if-none-match"), key)) {
    return new NextResponse(null, { status: 304, headers: cacheHeaders });
  }

  const safeName = quotationFileName(q);
  const pdfHeaders = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${safeName}"`,
    ...cacheHeaders,
  };

  // Cache HIT: the saved PDF was made from exactly these inputs.
  if (urlHasKey(q.pdfUrl, key)) {
    try {
      const cached = await fetch(q.pdfUrl!, { signal: AbortSignal.timeout(8000) });
      if (cached.ok) {
        return new NextResponse(new Uint8Array(await cached.arrayBuffer()), { headers: pdfHeaders });
      }
    } catch {
      // fall through and re-render
    }
  }

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderQuotationPdfBytes(inputs);
  } catch (e) {
    console.error("[quotation pdf] render failed for", q.number, e);
    return new NextResponse(
      "Failed to render quotation PDF: " +
        (e instanceof Error ? e.message : String(e)),
      { status: 500 },
    );
  }

  // Respond now; the upload + pdfUrl save run after the response (kept alive on
  // Vercel), so the next load, the send and the customer's /q link reuse it.
  after(async () => {
    try {
      await saveQuotationPdf(q, key, pdfBuffer);
    } catch (e) {
      console.error("[quotation pdf] cache upload failed for", q.number, e);
    }
  });

  return new NextResponse(new Uint8Array(pdfBuffer), { headers: pdfHeaders });
}
