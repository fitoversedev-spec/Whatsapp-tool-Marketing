/**
 * `POST /api/scout/reports/{reportId}/archive` — soft-delete a report.
 *
 * Sets `archived_at`, which is all {@link listAllReports} checks to keep the
 * row off `/scout/reports`. The PDF, its blob key, its shares and its signed
 * link are untouched — a link already handed to a customer keeps working
 * after the report is archived off the list. Mirrors the owner-or-admin
 * check every other report route uses (see `[reportId]/title/route.ts`).
 */

import { NextResponse } from "next/server";

import { canAccessAllScans, getScoutProfile } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import { archiveReport, findReportRow } from "@/lib/scout/reports/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: { reportId: string } },
) {
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

  await archiveReport(reportId);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
