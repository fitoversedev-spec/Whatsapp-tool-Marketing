import { NextResponse } from "next/server";

import { canAccessAllScans, getScoutProfile } from "@/lib/scout/identity";
import { findReportRow, getPublicReportRow } from "@/lib/scout/reports/repository";
import { reportStorage } from "@/lib/scout/reports/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: { reportId: string } }) {
  const { reportId } = context.params;

  const author = await getScoutProfile();
  if (!author) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const row = await getPublicReportRow(reportId);
  if (!row) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  if (row.status !== "generated" && row.status !== "delivered") {
    return NextResponse.json({ error: "Report not ready." }, { status: 409 });
  }

  const full = await findReportRow(reportId);
  if (full && full.scanId) {
    const { getScan } = await import("@/lib/scout/places/scanRepository");
    const scan = await getScan(full.scanId);
    if (scan && scan.ownerId !== author.userId && !canAccessAllScans(author)) {
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }
  }

  const file = await reportStorage().get(reportId);
  if (!file) return NextResponse.json({ error: "PDF not found." }, { status: 404 });

  const safeName = ((row.title || row.areaLabel).replace(/[^A-Za-z0-9]+/g, "_") || "SiteScout") +
    `_SiteScout_v${row.version}.pdf`;

  return new NextResponse(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
