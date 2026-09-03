/**
 * `GET /api/scout/map/satellite` — a satellite tile layer for the D3 spaces sweep.
 *
 * ## Why this endpoint exists at all
 *
 * The sweep screen is the one screen that is worthless on a street map: a
 * vacant plot and a built plot look identical in OSM's rendering. Every other
 * screen stays on free OSM tiles (`plan/DESIGN-ANALYSIS.md` §5, Option A), so
 * Google map-load billing is confined to this one route.
 *
 * Google's **Map Tiles API** serves 2D raster tiles that Leaflet can consume
 * directly, but the tile URL is not a constant: it carries a session token,
 * minted by `POST https://tile.googleapis.com/v1/createSession`. That is what
 * this route does, and it caches the token in memory until it expires so a
 * reload does not mint a second one.
 *
 * ## What it does when there is no key
 *
 * It says so. `{ available: false, reason }`, and the sweep screen keeps the
 * mockup's "satellite imagery unavailable" overlay over an OSM map. The one
 * thing that must never happen is a street map presented as imagery — a
 * surveyor would mark cells as empty ground from a rendering that shows no
 * buildings under about zoom 17.
 */

import { NextResponse } from "next/server";

import { getScoutIdentity } from "@/lib/scout/identity";
import { env } from "@/lib/scout/env";
import type { SatelliteLayerResponse } from "@/components/scout/map/siteMapConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREATE_SESSION_URL = "https://tile.googleapis.com/v1/createSession";
const TILE_BASE = "https://tile.googleapis.com/v1/2dtiles";

interface CachedSession {
  readonly token: string;
  /** Epoch ms. Google's sessions last hours; we re-mint a minute early. */
  readonly expiresAt: number;
}

/**
 * Process-local cache.
 *
 * Deliberately not a database row: the token is worthless outside the process
 * that holds it beyond its expiry, and a serverless instance that goes cold
 * simply mints another. One `createSession` call per warm instance per few
 * hours is not a cost worth a table.
 */
let cached: CachedSession | null = null;

const SESSION_SAFETY_MS = 60_000;

async function mintSession(key: string): Promise<CachedSession> {
  const response = await fetch(`${CREATE_SESSION_URL}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mapType: "satellite",
      language: "en-GB",
      region: "IN",
      // High-DPI tiles: a surveyor is looking for a wall line, not a landmark.
      scale: "scaleFactor2x",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`createSession returned ${response.status}: ${detail.slice(0, 300)}`);
  }

  const body = (await response.json()) as { session?: string; expiry?: string };
  if (!body.session) throw new Error("createSession returned no session token.");

  // `expiry` is epoch seconds as a string. Treat anything unparseable as short.
  const expirySeconds = Number(body.expiry);
  const expiresAt = Number.isFinite(expirySeconds)
    ? expirySeconds * 1000
    : Date.now() + 30 * 60_000;

  return { token: body.session, expiresAt };
}

export async function GET() {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const key = env.googleMapsBrowserKey;
  if (!key) {
    const body: SatelliteLayerResponse = {
      available: false,
      reason:
        "No browser Maps key is configured, so satellite imagery is unavailable. This is a " +
        "street map: buildings are drawn, but open ground and vacant plots are not " +
        "distinguishable from it. Set NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY to sweep properly.",
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    if (!cached || cached.expiresAt - SESSION_SAFETY_MS < Date.now()) {
      cached = await mintSession(key);
    }

    const body: SatelliteLayerResponse = {
      available: true,
      layer: {
        url: `${TILE_BASE}/{z}/{x}/{y}?session=${cached.token}&key=${key}`,
        attribution: "Imagery © Google",
        maxZoom: 22,
        requiresKey: true,
      },
      expiresAt: new Date(cached.expiresAt).toISOString(),
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    cached = null;
    console.error(
      JSON.stringify({
        tag: "map.satellite.session_failed",
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    const body: SatelliteLayerResponse = {
      available: false,
      reason:
        "Google refused a satellite tile session, so this is a street map. Check that the Map " +
        "Tiles API is enabled on the project and that the browser key allows this origin.",
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  }
}
