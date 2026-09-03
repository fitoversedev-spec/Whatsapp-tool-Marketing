/**
 * `POST /api/scout/scans` — create a scan job. `GET /api/scout/scans` — list recent scans.
 *
 * ⚠️ **This endpoint does not run the scan.** A tiled scan is dozens to
 * hundreds of billable Google calls and runs well past any serverless function
 * timeout, so POST plans the work, writes it to the database and returns in
 * milliseconds. A worker then processes it in slices via
 * `POST /api/scout/scans/{id}/run`, and the client watches `GET /api/scout/scans/{id}/progress`.
 *
 * The first slice is kicked off with `after()`, so the common case needs no
 * client involvement at all — but the scan is not *dependent* on that call
 * completing, which is the entire point. If the process dies, the next poll
 * reports `resumeRequired` and any caller can move it along from exactly where
 * it stopped.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/scout/db";
// Next 14.2 has no `after()` in next/server. See src/lib/after.ts.
import { after } from "@/lib/scout/after";
import { getScoutIdentity } from "@/lib/scout/identity";
import { env } from "@/lib/scout/env";
import { DailyCapExceededError } from "@/lib/scout/places/metering";
import { createScan, runScanSlice, ScanRequestError } from "@/lib/scout/places/scanPipeline";

export const runtime = "nodejs";
/** Only ever used by the `after()` kick-off; the response itself is immediate. */
export const maxDuration = 60;

const createSchema = z.object({
  areaLabel: z.string().trim().min(1).max(200),
  centre: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  radiusM: z.number().int().positive().max(50_000),
  categoryIds: z.array(z.string().trim().min(1)).min(1).max(50),
  siteId: z.string().uuid().nullish(),
  customerName: z.string().trim().max(200).nullish(),
  address: z.string().trim().max(2_000).nullish(),
});

export async function POST(request: NextRequest) {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  // Fail at the edge, before a scan row exists, rather than at tile 6 of 8
  // with a half-written job nobody can finish.
  if (!env.hasGoogleServerKey) {
    return NextResponse.json(
      {
        error:
          "GOOGLE_MAPS_SERVER_KEY is not configured, so scans cannot run. " +
          "Enable Places API (New) and Geocoding in the Google Cloud project and add a " +
          "server key to the environment.",
        code: "NO_API_KEY",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid scan request.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await createScan({ ownerId: identity.userId, ...parsed.data });

    // Fire the first slice without awaiting it. The response is already
    // decided; this only saves the client one round trip.
    after(async () => {
      try {
        await runScanSlice(result.scanId);
      } catch (error) {
        console.error(
          JSON.stringify({ tag: "scan.kickoff.failed", scanId: result.scanId, error: String(error) }),
        );
      }
    });

    return NextResponse.json(
      {
        scanId: result.scanId,
        jobId: result.jobId,
        totalTasks: result.totalTasks,
        tileCount: result.tileCount,
        estimate: result.estimate,
        progressUrl: `/api/scout/scans/${result.scanId}/progress`,
        runUrl: `/api/scout/scans/${result.scanId}/run`,
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof DailyCapExceededError) {
      return NextResponse.json({ error: error.message, code: "DAILY_CAP" }, { status: 429 });
    }
    if (error instanceof ScanRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}

export async function GET() {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const rows = await prisma.scan.findMany({
    where: { ownerId: identity.userId },
    select: {
      id: true,
      areaLabel: true,
      customerName: true,
      radiusM: true,
      status: true,
      facilityCount: true,
      demandCount: true,
      createdAt: true,
      /**
       * The stored score, so a list can badge and filter by verdict without a
       * second request per row.
       *
       * `scoreBasis` travels with the number, never separately: a `desk_only`
       * score is **not comparable** with a surveyed one, and a list that sorts
       * or ranks the two together without saying so is exactly the failure
       * Phase 3 made this a column to prevent.
       */
      scoreTotal: true,
      scoreVerdict: true,
      scoreBasis: true,
      scoreConfidence: true,
      // Was a LEFT JOIN on `scan_jobs`; flattened below so the JSON body keeps
      // the shape clients already parse.
      job: { select: { status: true, completedTasks: true, totalTasks: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    scans: rows.map(({ job, scoreTotal, ...scan }) => ({
      ...scan,
      // `numeric(5,2)` was a string under Drizzle and is a `Decimal` under
      // Prisma. `toFixed(2)` keeps the JSON field the same string it always was.
      scoreTotal: scoreTotal === null ? null : scoreTotal.toFixed(2),
      jobStatus: job?.status ?? null,
      completedTasks: job?.completedTasks ?? null,
      totalTasks: job?.totalTasks ?? null,
    })),
  });
}
