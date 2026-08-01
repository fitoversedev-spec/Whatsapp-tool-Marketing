// Public, unauthenticated invoice PDF link — the on-domain URL used in the
// customer WhatsApp message (mirrors /q/[id] for quotations). Renders the PDF
// on first access if it isn't cached yet, then 302s to the Blob URL. Keyed by
// the invoice UUID (not its human name) so links can't be enumerated.

import { NextRequest, NextResponse } from "next/server";
import { ensureInvoicePdfUrl } from "@/lib/invoice/render";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const url = await ensureInvoicePdfUrl(params.id);
    if (!url) return new NextResponse("Not found", { status: 404 });
    return NextResponse.redirect(url);
  } catch {
    return new NextResponse("Could not render invoice", { status: 500 });
  }
}
