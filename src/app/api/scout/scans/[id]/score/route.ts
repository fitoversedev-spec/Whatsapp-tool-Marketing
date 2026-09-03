/**
 * `POST /api/scout/scans/{id}/score` — compute and store the site score.
 * `GET  /api/scout/scans/{id}/score` — read the stored one back, unchanged.
 *
 * ## Why scoring does not wait for review analysis
 *
 * Theme extraction is the slow, paid part: one Claude call per competitor with
 * reviews. Blocking the score on it would put a multi-second network round
 * trip in front of a computation that takes microseconds, and would fail the
 * whole request when a classifier rate-limits. So the score is computed from
 * whatever themes are already cached, `themesPending` says whether more are
 * coming, and extraction is kicked off with `after()` — the same pattern Phase
 * 1 uses to start a scan job. Re-POSTing once it has finished can only raise
 * the score, because the missing part is four points component 4 declined to
 * award.
 *
 * ## Why the response carries the disclosures
 *
 * `POPULATION_LIMITATION_TEXT` must appear on any document carrying a
 * saturation figure. The scoring module deliberately emits no sentence
 * containing the word at all — that is what lets its own test assert their
 * absence absolutely — so the text is attached here, where the score meets the
 * thing that will render it.
 */

import { NextResponse } from "next/server";

// Next 14.2 has no `after()` in next/server. See src/lib/after.ts.
import { after } from "@/lib/scout/after";
import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import { extractThemesForScan, themeExtractionAvailable } from "@/lib/scout/reviews";
import {
  getStoredScore,
  NoActiveScoreModelError,
  ScanNotFoundError,
  ScoreModelVersionNotFoundError,
  scoreScan,
} from "@/lib/scout/siteScore";

export const runtime = "nodejs";
/** Scoring itself is fast; the `after()` extraction is what needs the room. */
export const maxDuration = 120;

async function authorise(id: string) {
  const identity = await getScoutIdentity();
  if (!identity) {
    return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  if (!identity.canRunScans) {
    return { error: NextResponse.json({ error: "Not permitted." }, { status: 403 }) };
  }
  const scan = await getScan(id);
  // A scan belonging to someone else returns 404, not 403: a 403 would confirm
  // the id exists.
  if (!scan || (scan.ownerId !== identity.userId && !canAccessAllScans(identity))) {
    return { error: NextResponse.json({ error: "Scan not found." }, { status: 404 }) };
  }
  return { identity, scan };
}

export async function POST(request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  /** Reproduce an old score under its own model version rather than the active one. */
  const modelVersion = url.searchParams.get("modelVersion") ?? undefined;

  try {
    const scored = await scoreScan(id, { modelVersion });

    const themesPending =
      themeExtractionAvailable() &&
      scored.score.flags.some((f) => f.code === "service_gap_themes_not_extracted");

    if (themesPending) {
      after(async () => {
        try {
          await extractThemesForScan(id);
          // Deliberately not re-scored here. The stored score is the one the
          // caller was just shown; changing it behind their back would make
          // the number on screen disagree with the number in the database.
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "review_theme_extraction_after_failed",
              scanId: id,
              error: error instanceof Error ? error.message : "unknown",
            }),
          );
        }
      });
    }

    return NextResponse.json(
      {
        scanId: id,
        score: scored.score,
        evidence: scored.evidence,
        disclosures: scored.disclosures,
        /**
         * True when review analysis is still to run. The UI may offer "refresh
         * the score" rather than silently showing a number that is about to
         * change.
         */
        themesPending,
        themeExtractionEnabled: themeExtractionAvailable(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ScanNotFoundError) {
      return NextResponse.json({ error: "Scan not found." }, { status: 404 });
    }
    if (error instanceof NoActiveScoreModelError) {
      return NextResponse.json(
        { error: error.message, code: "NO_SCORE_MODEL" },
        { status: 503 },
      );
    }
    if (error instanceof ScoreModelVersionNotFoundError) {
      return NextResponse.json(
        { error: error.message, code: "UNKNOWN_SCORE_MODEL" },
        { status: 400 },
      );
    }
    throw error;
  }
}

export async function GET(_request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  const stored = await getStoredScore(id);
  if (!stored) {
    return NextResponse.json(
      { error: "This scan has not been scored yet.", code: "NOT_SCORED" },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      scanId: id,
      score: stored.score,
      modelVersion: stored.modelVersion,
      scoredAt: stored.scoredAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
