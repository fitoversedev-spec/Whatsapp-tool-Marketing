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

/** Follow redirects on a Google Maps short link and extract lat/lng from the final URL. */
async function resolveGoogleMapsUrl(url: string): Promise<{ lat: number; lng: number } | null> {
  const res = await fetch(url, { method: "GET", redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
  const finalUrl = res.url;

  // @lat,lng
  const atMatch = finalUrl.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (atMatch) return { lat: Number(atMatch[1]), lng: Number(atMatch[2]) };
  // ?q=lat,lng
  const qMatch = finalUrl.match(/[?&](?:q|ll|query|center)=(-?\d+\.?\d*)[,+%20]+(-?\d+\.?\d*)/);
  if (qMatch) return { lat: Number(qMatch[1]), lng: Number(qMatch[2]) };
  // /place/lat,lng
  const placeMatch = finalUrl.match(/\/place\/(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (placeMatch) return { lat: Number(placeMatch[1]), lng: Number(placeMatch[2]) };
  // !3d (lat) and !4d (lng) in data params
  const dMatch = finalUrl.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
  if (dMatch) return { lat: Number(dMatch[1]), lng: Number(dMatch[2]) };

  // Try parsing the HTML body for coords if URL didn't contain them
  const body = await res.text();
  const bodyMatch = body.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (bodyMatch) return { lat: Number(bodyMatch[1]), lng: Number(bodyMatch[2]) };

  return null;
}
