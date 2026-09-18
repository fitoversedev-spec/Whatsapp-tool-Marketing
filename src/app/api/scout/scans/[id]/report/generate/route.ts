/**
 * `POST /api/scout/scans/{id}/report/generate` — start rendering the PDF.
 * `GET  /api/scout/scans/{id}/report/generate` — how the latest attempt is going.
 *
 * PDF is built with pdf-lib (pure JS, no Chromium). The work runs in `after()`,
 * the client polls `GET`, and the row carries the outcome either way.
 */

import { NextResponse } from "next/server";

// Next 14.2 has no `after()` in next/server. See src/lib/after.ts.
import { after } from "@/lib/scout/after";
import { canAccessAllScans, getScoutProfile } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import {
  latestGeneratedReport,
  reportLink,
  runReportGeneration,
  startReportGeneration,
  type ReportGenerationRow,
} from "@/lib/scout/reports/generate";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function withLink(row: ReportGenerationRow | null) {
  if (!row) return null;
  if (row.status !== "generated" && row.status !== "delivered") return { ...row, link: null };
  if (!row.expiresAt) return { ...row, link: null };
  return { ...row, link: reportLink(row.id, new Date(row.expiresAt)) };
}

async function authorise(id: string) {
  // A report prints "Prepared by <name>", so this one resolves the profile
  // rather than the bare identity. A ScoutProfile is a ScoutIdentity.
  const author = await getScoutProfile();
  if (!author) {
    return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  if (!author.canRunScans) {
    return { error: NextResponse.json({ error: "Not permitted." }, { status: 403 }) };
  }
  const scan = await getScan(id);
  // Someone else's scan is a 404, never a 403 — a 403 confirms the id exists.
  if (!scan || (scan.ownerId !== author.userId && !canAccessAllScans(author))) {
    return { error: NextResponse.json({ error: "Scan not found." }, { status: 404 }) };
  }
  return { author, scan };
}

export async function GET(_request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  return NextResponse.json(
    { scanId: id, report: withLink(await latestGeneratedReport(id)) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(_request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  const row = await startReportGeneration(auth.author, id);
  if (!row) {
    return NextResponse.json({ error: "This scan has no results to report on." }, { status: 409 });
  }

  const author = auth.author;
  after(async () => {
    await runReportGeneration(author, row.id);
  });

  return NextResponse.json(
    { scanId: id, report: withLink(row) },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
