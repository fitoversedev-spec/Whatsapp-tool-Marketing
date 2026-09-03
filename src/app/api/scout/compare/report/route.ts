/**
 * `POST /api/compare/report` — build the D4 comparison as a document.
 * `GET  /api/compare/report?ids=a,b,c` — the latest comparison for that set.
 *
 * Same asynchronous shape as a single-scan report: a row is claimed, the render
 * runs in `after()`, the client polls. A comparison is a shorter document but
 * it goes through the same Chromium launch, so it earns the same treatment.
 *
 * Scans the caller may not read are silently dropped by `getCompareSubjects`
 * before anything is built — the same 404-not-403 rule as everywhere else — so
 * a request naming somebody else's scan produces a comparison of the ones it
 * could see, or a 400 if fewer than two remain.
 */

import { NextResponse } from "next/server";

// Next 14.2 has no `after()` in next/server. See src/lib/after.ts.
import { after } from "@/lib/scout/after";
import { getScoutIdentity, getScoutProfile } from "@/lib/scout/identity";
import {
  latestGeneratedReport,
  reportLink,
  runComparisonGeneration,
  startComparisonGeneration,
  type ReportGenerationRow,
} from "@/lib/scout/reports/generate";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

function withLink(row: ReportGenerationRow | null) {
  if (!row) return null;
  if (row.status !== "generated" && row.status !== "delivered") return { ...row, link: null };
  if (!row.expiresAt) return { ...row, link: null };
  return { ...row, link: reportLink(row.id, new Date(row.expiresAt)) };
}

function parseIds(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  return list
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .slice(0, 4);
}

export async function GET(request: Request) {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const ids = parseIds(new URL(request.url).searchParams.get("ids"));
  if (ids.length === 0) return NextResponse.json({ report: null });

  return NextResponse.json(
    { report: withLink(await latestGeneratedReport(ids[0]!)) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  // The comparison document prints "Prepared by <name>".
  const author = await getScoutProfile();
  if (!author) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!author.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const ids = parseIds((body as { scanIds?: unknown })?.scanIds);

  if (ids.length < 2) {
    return NextResponse.json(
      { error: "A comparison report needs at least two scans." },
      { status: 400 },
    );
  }

  const row = await startComparisonGeneration(author, ids);
  if (!row) {
    return NextResponse.json(
      { error: "Fewer than two of those scans could be read." },
      { status: 400 },
    );
  }

  after(async () => {
    await runComparisonGeneration(author, row.id);
  });

  return NextResponse.json(
    { report: withLink(row) },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
