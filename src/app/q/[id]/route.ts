// Public, unauthenticated redirect to a quotation's PDF — deliberately NOT
// gated by getCurrentUser() like /api/quotations/[id]/pdf is (that route
// 401s for a customer with no session, which is what was surfacing as a
// login-wall when the raw Blob URL's own domain looked untrustworthy —
// see docs/DECISIONS.md). This exists purely to give the customer-facing
// WhatsApp Web link a clean, on-domain URL instead of Vercel's Blob
// storage subdomain.
//
// Keyed by the quotation's UUID, not its human-readable number — numbers
// are sequential (FIT-QT-2026-086, -085, -084...), so a number-keyed path
// would let anyone enumerate other customers' quotations. The UUID isn't
// guessable that way.
//
// The link always opens the NEWEST version: if the saved PDF is missing or the
// quote was edited since it was saved, it is rebuilt first (pdf-cache.ts).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureQuotationPdf } from "@/lib/quotation/pdf-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // a rebuild renders + uploads the PDF

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const q = await prisma.quotation.findUnique({ where: { id: params.id } });
  if (!q) return new NextResponse("Not found", { status: 404 });
  try {
    const { url } = await ensureQuotationPdf(q);
    return NextResponse.redirect(url);
  } catch (e) {
    console.error("[q] quotation pdf unavailable for", q.number, e);
    return new NextResponse("This quotation is not ready right now. Please try again in a minute.", {
      status: 503,
      headers: { "Retry-After": "30" },
    });
  }
}
