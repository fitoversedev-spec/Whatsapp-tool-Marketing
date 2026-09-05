/**
 * `PATCH /api/scout/reports/{reportId}/title` — rename a report.
 *
 * A rename only ever touches `reports.title`. The PDF already produced (if
 * any) keeps its bytes, its blob key and its signed link; renaming changes
 * how the studio and the reports list label the row, nothing a customer who
 * already has the link would ever notice.
 */

import { NextResponse } from "next/server";

import { canAccessAllScans, getScoutProfile } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import { findReportRow, updateReportTitle } from "@/lib/scout/reports/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: { reportId: string } }) {
  const author = await getScoutProfile();
  if (!author) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!author.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const { reportId } = context.params;

  const report = await findReportRow(reportId);
  if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });

  const scan = await getScan(report.scanId);
  // Someone else's report is a 404, never a 403 — matches every other report route.
  if (!scan || (scan.ownerId !== author.userId && !canAccessAllScans(author))) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  let body: { title?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim().slice(0, 240) : "";
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  await updateReportTitle(reportId, title);
  return NextResponse.json({ ok: true, title }, { headers: { "Cache-Control": "no-store" } });
}
