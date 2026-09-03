/**
 * `GET /api/scout/scans/{id}/report` — the report studio's draft state.
 * `PUT /api/scout/scans/{id}/report` — save the Include toggles and the field notes.
 *
 * **This endpoint does not generate anything.** PDF rendering and WhatsApp
 * delivery are Phase 6's, and the studio's Generate button is stubbed against
 * them on purpose: a half-built PDF path that produced a broken file would be
 * worse than a button that says plainly it is not wired yet.
 */

import { NextResponse } from "next/server";

import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import { getReportDraft, saveReportDraft } from "@/lib/scout/reports/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorise(id: string) {
  const identity = await getScoutIdentity();
  if (!identity) {
    return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  if (!identity.canRunScans) {
    return { error: NextResponse.json({ error: "Not permitted." }, { status: 403 }) };
  }
  const scan = await getScan(id);
  if (!scan || (scan.ownerId !== identity.userId && !canAccessAllScans(identity))) {
    return { error: NextResponse.json({ error: "Scan not found." }, { status: 404 }) };
  }
  return { identity, scan };
}

export async function GET(_request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  const draft = await getReportDraft(id);
  return NextResponse.json({ scanId: id, draft }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const payload = (body ?? {}) as {
    includedBlocks?: unknown;
    fieldNotes?: unknown;
    title?: unknown;
  };

  const draft = await saveReportDraft({
    scanId: id,
    userId: auth.identity.userId,
    includedBlocks: payload.includedBlocks,
    fieldNotes: typeof payload.fieldNotes === "string" ? payload.fieldNotes : "",
    title: typeof payload.title === "string" ? payload.title : undefined,
  });

  return NextResponse.json({ scanId: id, draft }, { headers: { "Cache-Control": "no-store" } });
}
