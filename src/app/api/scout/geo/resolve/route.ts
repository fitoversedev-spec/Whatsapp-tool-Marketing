/**
 * `POST /api/geo/resolve` — turn an address into a point, or a point into an
 * address.
 *
 * ## Why this is a server route and not a browser call
 *
 * Geocoding is billed, and the key that pays for it is `GOOGLE_MAPS_SERVER_KEY`
 * — deliberately without a `NEXT_PUBLIC_` prefix so importing it into a client
 * component is a build error rather than a key on a public CDN. The phone
 * therefore asks this route, which holds the key, meters the call against the
 * user, and returns only the two things the screen needs.
 *
 * ## Why one route does both directions
 *
 * They are the same screen interaction seen from two ends. The surveyor either
 * types an address (forward) or taps "Use my current location" and then drags
 * the pin (reverse), and in both cases the result is `{ lat, lng, address }`
 * feeding the same piece of state. Splitting them would duplicate the auth, the
 * key check and the metering for no gain.
 *
 * Reverse geocoding is best-effort by design: a pin with no printable address
 * is still a perfectly good scan centre, so a failure here degrades to "no
 * address" rather than blocking the scan.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { getScoutIdentity } from "@/lib/scout/identity";
import { env } from "@/lib/scout/env";
import { createGoogleClient } from "@/lib/scout/places/googleClient";
import { meterFromCallLog } from "@/lib/scout/places/metering";
import type { CallLog } from "@/lib/scout/places/googleClient";

export const runtime = "nodejs";

const bodySchema = z.union([
  z.object({ address: z.string().trim().min(2).max(300) }),
  z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
]);

export interface ResolvedPlace {
  readonly lat: number;
  readonly lng: number;
  readonly address: string | null;
}

export async function POST(request: Request) {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  if (!env.hasGoogleServerKey) {
    return NextResponse.json(
      {
        error:
          "Address lookup is unavailable because GOOGLE_MAPS_SERVER_KEY is not configured. " +
          "You can still set the plot by dragging the pin on the map.",
        code: "NO_API_KEY",
      },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Send either { address } or { lat, lng }.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Every billable call is metered against the user before the money is spent.
  const logs: CallLog[] = [];
  const client = createGoogleClient({ logger: (log) => logs.push(log) });

  try {
    const response =
      "address" in parsed.data
        ? await client.geocode(parsed.data.address)
        : await client.reverseGeocode({ lat: parsed.data.lat, lng: parsed.data.lng });

    const first = response.results?.[0];
    const location = first?.geometry?.location;

    if ("address" in parsed.data) {
      if (!location) {
        return NextResponse.json(
          {
            error: "No place matched that address. Try a landmark, or drag the pin onto the plot.",
            code: "NOT_FOUND",
          },
          { status: 404 },
        );
      }
      const result: ResolvedPlace = {
        lat: location.lat,
        lng: location.lng,
        address: first?.formatted_address ?? null,
      };
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    /**
     * Reverse: the pin is authoritative, not Google's snapped result. A plot on
     * an unnamed access road reverse-geocodes to the nearest addressed building
     * fifty metres away, and moving the scan centre there would silently scan
     * the wrong catchment.
     */
    const result: ResolvedPlace = {
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      address: first?.formatted_address ?? null,
    };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(
      JSON.stringify({ tag: "geo.resolve.failed", error: error instanceof Error ? error.message : "unknown" }),
    );
    return NextResponse.json(
      {
        error: "Address lookup failed. You can still set the plot by dragging the pin.",
        code: "GEOCODE_FAILED",
      },
      { status: 502 },
    );
  } finally {
    for (const log of logs) {
      try {
        await meterFromCallLog(log, { userId: identity.userId, scanId: null });
      } catch (meterError) {
        console.error(
          JSON.stringify({ tag: "geo.meter.failed", error: String(meterError) }),
        );
      }
    }
  }
}
