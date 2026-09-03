/**
 * `PUT /api/scout/scans/{id}/survey` — record what the surveyor observed.
 * `GET /api/scout/scans/{id}/survey` — the checklist definition plus current answers.
 *
 * The checklist itself is defined once, in `src/lib/scoring/checklist.ts`, and
 * this endpoint hands it out with the answers so a mobile client can render
 * the form generically. Phases 4, 5 and 6 must not restate the fields: two
 * hand-rolled copies drift, and a drifted label on a printed report is a number
 * the salesperson cannot explain.
 *
 * ## Absent is not zero
 *
 * A field the surveyor did not answer is **omitted**, never sent as `0` —
 * zero is the worst possible observation ("night play prohibited"), and
 * conflating the two would score an unvisited corner of a site as a bad one.
 * `sanitiseSurveyorInputs` drops anything malformed rather than clamping it,
 * for the same reason: a clamped 7 would be scored as an observation nobody
 * made.
 */

import { NextResponse } from "next/server";

import { Prisma, prisma } from "@/lib/scout/db";
import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import {
  CHECKLIST_GROUPS,
  CHECKLIST_MAX_RATING,
  CHECKLIST_VERSION,
  SURVEYOR_CHECKLIST,
  sanitiseSurveyorInputs,
} from "@/lib/scout/scoring";

export const runtime = "nodejs";

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

/** The form definition, identical for every scan. */
const CHECKLIST_PAYLOAD = {
  checklistVersion: CHECKLIST_VERSION,
  maxRating: CHECKLIST_MAX_RATING,
  groups: CHECKLIST_GROUPS.map((group) => ({
    ...group,
    fields: SURVEYOR_CHECKLIST.filter((f) => f.group === group.id).map((f) => ({
      id: f.id,
      label: f.label,
      help: f.help,
      anchors: f.anchors,
    })),
  })),
};

export async function GET(_request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  const row = await prisma.scan.findUnique({
    where: { id },
    select: { surveyorInputs: true, fieldNotes: true },
  });

  const answers = sanitiseSurveyorInputs(row?.surveyorInputs);
  return NextResponse.json({
    scanId: id,
    ...CHECKLIST_PAYLOAD,
    answers,
    answeredCount: Object.keys(answers).length,
    fieldNotes: row?.fieldNotes ?? null,
  });
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

  const payload = (body ?? {}) as { answers?: unknown; fieldNotes?: unknown };
  const submitted = (payload.answers ?? {}) as Record<string, unknown>;
  const answers = sanitiseSurveyorInputs(submitted);

  /**
   * Report what was thrown away rather than accepting it silently. A client
   * sending a renamed field id should see that its value never landed, not
   * discover it when the score comes back lower than the form implied.
   */
  const rejected = Object.keys(submitted).filter((key) => !(key in answers));

  const fieldNotes =
    typeof payload.fieldNotes === "string" ? payload.fieldNotes.slice(0, 4000) : undefined;

  // Raw so `updated_at` keeps taking the database's `now()` rather than this
  // process's clock, as it did under Drizzle.
  const notes = fieldNotes === undefined ? Prisma.empty : Prisma.sql`, field_notes = ${fieldNotes}`;
  await prisma.$executeRaw(Prisma.sql`
    UPDATE scans
    SET surveyor_inputs = ${JSON.stringify(answers)}::jsonb${notes}, updated_at = now()
    WHERE id = ${id}::uuid
  `);

  return NextResponse.json({
    scanId: id,
    checklistVersion: CHECKLIST_VERSION,
    answers,
    answeredCount: Object.keys(answers).length,
    totalFields: SURVEYOR_CHECKLIST.length,
    rejected,
    /** Re-POST the score endpoint to fold these observations into the total. */
    rescoreRequired: true,
  });
}
