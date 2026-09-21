import { NextResponse, type NextRequest } from "next/server";

import { getScoutIdentity } from "@/lib/scout/identity";
import { env } from "@/lib/scout/env";
import { GOOGLE_PLACES_BASE_URL } from "@/lib/scout/places/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AutocompleteSuggestion {
  type: "place" | "query";
  text: string;
  secondary: string;
  googleType: string | null;
}

export async function GET(request: NextRequest) {
  const identity = await getScoutIdentity();
  if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  if (!env.hasGoogleServerKey) {
    return NextResponse.json({ error: "Google key not configured." }, { status: 503 });
  }

  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ suggestions: [] }, { status: 200 });
  }

  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));

  const body: Record<string, unknown> = { input: q };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    body.locationBias = {
      circle: { center: { latitude: lat, longitude: lng }, radius: 5000 },
    };
  }

  try {
    const res = await fetch(`${GOOGLE_PLACES_BASE_URL}/places:autocomplete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.requireGoogleMapsServerKey(),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error(JSON.stringify({ tag: "autocomplete.failed", status: res.status }));
      return NextResponse.json({ suggestions: [] }, { status: 200 });
    }

    const data = await res.json();
    const suggestions: AutocompleteSuggestion[] = [];

    for (const s of (data.suggestions ?? []).slice(0, 5)) {
      if (s.placePrediction) {
        const pp = s.placePrediction;
        suggestions.push({
          type: "place",
          text: pp.structuredFormat?.mainText?.text ?? pp.text?.text ?? "",
          secondary: pp.structuredFormat?.secondaryText?.text ?? "",
          googleType: pp.types?.[0] ?? null,
        });
      } else if (s.queryPrediction) {
        const qp = s.queryPrediction;
        suggestions.push({
          type: "query",
          text: qp.structuredFormat?.mainText?.text ?? qp.text?.text ?? "",
          secondary: "",
          googleType: null,
        });
      }
    }

    return NextResponse.json(
      { suggestions },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(JSON.stringify({
      tag: "autocomplete.error",
      error: error instanceof Error ? error.message : "unknown",
    }));
    return NextResponse.json({ suggestions: [] }, { status: 200 });
  }
}
