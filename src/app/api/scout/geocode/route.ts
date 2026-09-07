/**
 * `GET /api/geocode?q=…` — turn a typed address into a scan centre.
 * `GET /api/geocode?lat=…&lng=…` — turn a dragged pin back into an address.
 *
 * A thin proxy over the Google client, and the only reason it exists: the
 * geocoding key is `GOOGLE_MAPS_SERVER_KEY`, which deliberately has no
 * `NEXT_PUBLIC_` prefix so that importing it into a client component is a build
 * error. The scan screen therefore cannot geocode for itself, and must ask the
 * server.
 *
 * Every call is metered like any other billable Google call, against the
 * signed-in user — a geocode is cheap but it is not free, and a scan screen
 * that fires one per keystroke would be invisible in the bill without this.
 */

import { NextResponse, type NextRequest } from "next/server";

import { getScoutIdentity } from "@/lib/scout/identity";
import { env } from "@/lib/scout/env";
import { createGoogleClient } from "@/lib/scout/places/googleClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  if (!env.hasGoogleServerKey) {
    return NextResponse.json(
      {
        error:
          "GOOGLE_MAPS_SERVER_KEY is not configured, so addresses cannot be looked up. " +
          "Drag the pin to set the scan centre instead.",
        code: "NO_API_KEY",
      },
      { status: 503 },
    );
  }

  const params = request.nextUrl.searchParams;
  const query = params.get("q")?.trim();
  const mapsUrl = params.get("url")?.trim();
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const hasPin = Number.isFinite(lat) && Number.isFinite(lng);

  if (mapsUrl) {
    try {
      const resolved = await resolveGoogleMapsUrl(mapsUrl);
      if (!resolved) {
        return NextResponse.json(
          { results: [], error: "Could not extract a location from that link. Try pasting the address instead." },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }
      const client = createGoogleClient();
      const revResponse = await client.reverseGeocode(resolved);
      const addr = revResponse.results?.[0]?.formatted_address ?? null;
      return NextResponse.json(
        { results: [{ formattedAddress: addr ?? `${resolved.lat.toFixed(6)}, ${resolved.lng.toFixed(6)}`, location: resolved, placeId: revResponse.results?.[0]?.place_id ?? null }] },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return NextResponse.json(
        { results: [], error: "Could not resolve that link. Try pasting the address instead." },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  if (!query && !hasPin) {
    return NextResponse.json(
      { error: "Pass either q= for an address or lat= and lng= for a pin." },
      { status: 400 },
    );
  }

  try {
    const client = createGoogleClient();
    const response = query
      ? await client.geocode(query)
      : await client.reverseGeocode({ lat, lng });

    const results = (response.results ?? []).slice(0, 5).map((r) => ({
      formattedAddress: r.formatted_address,
      location: {
        lat: r.geometry?.location?.lat ?? null,
        lng: r.geometry?.location?.lng ?? null,
      },
      placeId: r.place_id ?? null,
    }));

    if (results.length === 0) {
      return NextResponse.json(
        {
          results: [],
          error:
            query != null
              ? `Google found nothing for “${query}”. Try a landmark, or drag the pin instead.`
              : "Google has no address for that point. The coordinates still work for a scan.",
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { results },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      JSON.stringify({ tag: "geocode.failed", error: error instanceof Error ? error.message : "unknown" }),
    );
    return NextResponse.json(
      {
        error:
          "The address lookup failed. Drag the pin to place the scan centre, or try again in a moment.",
        code: "GEOCODE_FAILED",
      },
      { status: 502 },
    );
  }
}

/** Follow redirects on a Google Maps short link and extract lat/lng from the final URL or body. */
async function resolveGoogleMapsUrl(url: string): Promise<{ lat: number; lng: number } | null> {
  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  const finalUrl = res.url;

  const tryExtract = (s: string): { lat: number; lng: number } | null => {
    // !3d/!4d = exact place coords, checked first (@ is only viewport center)
    const d = s.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
    if (d) return { lat: Number(d[1]), lng: Number(d[2]) };
    const pl = s.match(/\/place\/(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (pl) return { lat: Number(pl[1]), lng: Number(pl[2]) };
    const q = s.match(/[?&](?:q|ll|query|center)=(-?\d+\.?\d*)[,+%20]+(-?\d+\.?\d*)/);
    if (q) return { lat: Number(q[1]), lng: Number(q[2]) };
    const at = s.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
    return null;
  };

  const fromUrl = tryExtract(finalUrl);
  if (fromUrl) return fromUrl;

  const body = await res.text();
  const fromBody = tryExtract(body);
  if (fromBody) return fromBody;

  // meta refresh redirect: <meta http-equiv="refresh" content="0;url=...">
  const metaMatch = body.match(/content=["'][^"']*url=([^"']+)/i);
  if (metaMatch) {
    const fromMeta = tryExtract(metaMatch[1]);
    if (fromMeta) return fromMeta;
  }

  // window.location or location.href = "..." in scripts
  const jsMatch = body.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)/i);
  if (jsMatch) {
    const fromJs = tryExtract(jsMatch[1]);
    if (fromJs) return fromJs;
  }

  return null;
}
