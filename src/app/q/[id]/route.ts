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
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const q = await prisma.quotation.findUnique({ where: { id: params.id }, select: { pdfUrl: true } });
  if (!q?.pdfUrl) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(q.pdfUrl);
}
