/**
 * `GET  /api/places/{placeId}?scan={scanId}` — one competitor, as the phone's
 * screen 03 needs it.
 * `PUT  /api/places/{placeId}` — record what the surveyor observed at it.
 *
 * `{placeId}` is Google's `place_id` string, which is the global identity key
 * everywhere else in this system (Phase 1 §4). It is URL-encoded in the path.
 *
 * ## Observed and entered are returned separately, on purpose
 *
 * `observed` is what Google supplied: rating, review count, hours, price level,
 * website, phone. `entered` is what a person standing at the gate typed:
 * flooring, setting, courts, pay-and-play and the hourly rate. They have wholly
 * different reliability and the screen has to be able to say which is which —
 * merging them into one bag would put "₹1,200/hr" and "4.4 ★ from 312 reviews"
 * side by side as if they were the same kind of claim.
 *
 * ## Why the scan id is required for the distance card
 *
 * "0.6 km, north-east" is measured **from the customer's plot**, so it only
 * exists relative to a scan. Without `?scan=` the endpoint still returns the
 * venue, just without a distance — which is the honest answer rather than a
 * distance from somewhere unstated.
 */

import { NextResponse } from "next/server";

import { Prisma, prisma } from "@/lib/scout/db";
import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { compassDirection } from "@/lib/scout/geo/bearing";
import { getScan } from "@/lib/scout/places/scanRepository";
import { getCategory } from "@/lib/scout/places/taxonomy";
import { ANALYSED_MARKER_THEME, reviewThemeLabel } from "@/lib/scout/scoring";
import { sanitiseVenueSurvey, VENUE_SURVEY_FIELDS, VENUE_SURVEY_VERSION } from "@/lib/scout/venueSurvey";

export const runtime = "nodejs";

/** Raw: `places.location` is `Unsupported`, so lat/lng are projected out. */
async function loadPlace(googlePlaceId: string) {
  const [row] = await prisma.$queryRaw<
    Array<{
      id: string;
      placeId: string;
      name: string;
      rating: number | null;
      reviewCount: number | null;
      address: string | null;
      hours: unknown;
      priceLevel: number | null;
      website: string | null;
      phone: string | null;
      businessStatus: string | null;
      primaryTypeDisplayName: string | null;
      googleMapsUri: string | null;
      operatingWindow: unknown;
      lat: number;
      lng: number;
    }>
  >(Prisma.sql`
    SELECT id, place_id AS "placeId", name, rating, review_count AS "reviewCount",
           address, hours, price_level AS "priceLevel", website, phone,
           business_status AS "businessStatus",
           primary_type_display_name AS "primaryTypeDisplayName",
           google_maps_uri AS "googleMapsUri",
           operating_window AS "operatingWindow",
           ST_Y(location::geometry) AS lat,
           ST_X(location::geometry) AS lng
    FROM places
    WHERE place_id = ${googlePlaceId}
    LIMIT 1
  `);
  return row ?? null;
}

/** The surveyor's key/value rows, reduced to the fields that still exist. */
async function loadEntered(internalPlaceId: string): Promise<Record<string, string>> {
  const rows = await prisma.placeTag.findMany({
    where: { placeId: internalPlaceId },
    select: { key: true, value: true },
  });

  const known = new Set(VENUE_SURVEY_FIELDS.map((f) => f.id));
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (known.has(row.key) && row.value) out[row.key] = row.value;
  }
  return out;
}

export async function GET(request: Request, context: { params: { placeId: string } }) {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const { placeId } = context.params;
  const googlePlaceId = decodeURIComponent(placeId);
  const scanId = new URL(request.url).searchParams.get("scan");

  const place = await loadPlace(googlePlaceId);
  if (!place) return NextResponse.json({ error: "Place not found." }, { status: 404 });

  /* --------------------------------------------- scan-relative context */

  let membership: {
    categories: string[];
    /** Resolved here so the client never has to import the taxonomy — the
     * module also holds the Google search strings, which have no business in a
     * browser bundle. */
    categoryLabels: string[];
    side: string;
    distanceM: number | null;
    direction: string | null;
  } | null = null;

  if (scanId) {
    const scan = await getScan(scanId);
    // Someone else's scan returns 404, never 403 — a 403 confirms the id exists.
    if (!scan || (scan.ownerId !== identity.userId && !canAccessAllScans(identity))) {
      return NextResponse.json({ error: "Scan not found." }, { status: 404 });
    }

    const row = await prisma.scanPlace.findUnique({
      where: { scanId_placeId: { scanId, placeId: place.id } },
      select: { categories: true, side: true, distanceM: true },
    });

    if (row) {
      membership = {
        categories: row.categories,
        categoryLabels: row.categories.map((id) => getCategory(id)?.label ?? id),
        side: row.side,
        distanceM: row.distanceM,
        direction: compassDirection(scan.centre, { lat: place.lat, lng: place.lng }),
      };
    }
  }

  /* ------------------------------------------------------------ themes */

  const themeRows = await prisma.reviewTheme.findMany({
    where: { placeId: place.id, theme: { not: ANALYSED_MARKER_THEME } },
    select: { theme: true, sentiment: true, mentionCount: true, evidence: true },
    orderBy: { mentionCount: "desc" },
    take: 20,
  });

  /**
   * The marker row records that the venue **was** analysed. Without it,
   * "analysed and nothing was found" and "not analysed yet" are the same empty
   * list, and those are different findings — the screen says which.
   */
  const marker = await prisma.reviewTheme.findFirst({
    where: { placeId: place.id, theme: ANALYSED_MARKER_THEME },
    select: { id: true },
  });

  const complaints = themeRows
    .filter((t) => t.sentiment === "negative")
    .map((t) => ({
      theme: t.theme,
      label: reviewThemeLabel(t.theme),
      mentionCount: t.mentionCount,
      quotes: (Array.isArray(t.evidence) ? (t.evidence as Array<Record<string, unknown>>) : [])
        .map((e) => (typeof e?.quote === "string" ? e.quote : null))
        .filter((q): q is string => Boolean(q))
        .slice(0, 2),
    }));

  return NextResponse.json(
    {
      observed: {
        placeId: place.placeId,
        name: place.name,
        location: { lat: place.lat, lng: place.lng },
        rating: place.rating,
        reviewCount: place.reviewCount,
        address: place.address,
        priceLevel: place.priceLevel,
        website: place.website,
        phone: place.phone,
        businessStatus: place.businessStatus,
        primaryTypeDisplayName: place.primaryTypeDisplayName,
        googleMapsUri: place.googleMapsUri,
        hours: place.hours,
        operatingWindow: place.operatingWindow,
      },
      membership,
      entered: await loadEntered(place.id),
      fields: VENUE_SURVEY_FIELDS,
      venueSurveyVersion: VENUE_SURVEY_VERSION,
      themes: {
        analysed: Boolean(marker) || themeRows.length > 0,
        complaints,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request, context: { params: { placeId: string } }) {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const { placeId } = context.params;
  const place = await loadPlace(decodeURIComponent(placeId));
  if (!place) return NextResponse.json({ error: "Place not found." }, { status: 404 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { values, rejected } = sanitiseVenueSurvey((raw as { values?: unknown })?.values ?? raw);

  /**
   * Upsert each field. An empty string deletes the row rather than storing a
   * blank, so "not recorded" and "recorded as nothing" stay the same state —
   * the same rule the surveyor checklist follows for absent ratings.
   */
  for (const [key, value] of Object.entries(values)) {
    if (value === "") {
      await prisma.placeTag.deleteMany({ where: { placeId: place.id, key } });
      continue;
    }
    await prisma.placeTag.upsert({
      where: { placeId_key: { placeId: place.id, key } },
      create: { placeId: place.id, key, value, createdBy: identity.userId },
      update: { value, createdBy: identity.userId },
    });
  }

  return NextResponse.json({
    placeId: place.placeId,
    entered: await loadEntered(place.id),
    /** What did not land, so the client never assumes a value was accepted. */
    rejected,
    venueSurveyVersion: VENUE_SURVEY_VERSION,
  });
}
