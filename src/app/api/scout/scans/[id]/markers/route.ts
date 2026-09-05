/**
 * `GET  /api/scout/scans/{id}/markers` — list the custom map markers a
 * surveyor has dropped on this scan's map.
 * `POST /api/scout/scans/{id}/markers` — drop a new one at a lat/lng.
 *
 * A `ScanMarker` is entirely user-authored — a customer location, a
 * competitor area, or a free-form note — and carries no Google identity, so
 * it is a distinct model from the Google-sourced `Place` markers already
 * plotted on the map. Every marker belongs to exactly one scan.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/scout/db";
import { canAccessAllScans, getScoutProfile, type ScoutProfile } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  label: z.string().trim().min(1).max(200),
  category: z.enum(["customer", "competitor", "custom"]).default("custom"),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  note: z.string().trim().max(500).nullish(),
});

async function authorise(
  scanId: string,
): Promise<{ error: NextResponse } | { profile: ScoutProfile }> {
  const profile = await getScoutProfile();
  if (!profile) {
    return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  if (!profile.canRunScans) {
    return { error: NextResponse.json({ error: "Not permitted." }, { status: 403 }) };
  }
  const scan = await getScan(scanId);
  // Someone else's scan is a 404, never a 403 — a 403 confirms the id exists.
  if (!scan || (scan.ownerId !== profile.userId && !canAccessAllScans(profile))) {
    return { error: NextResponse.json({ error: "Scan not found." }, { status: 404 }) };
  }
  return { profile };
}

export async function GET(_request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  const markers = await prisma.scanMarker.findMany({
    where: { scanId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      label: true,
      category: true,
      lat: true,
      lng: true,
      note: true,
      createdBy: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ markers }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: { id: string } }) {
  const { id } = context.params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid marker.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const marker = await prisma.scanMarker.create({
    data: {
      scanId: id,
      createdBy: auth.profile.userId,
      label: parsed.data.label,
      category: parsed.data.category,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      note: parsed.data.note || null,
    },
    select: {
      id: true,
      label: true,
      category: true,
      lat: true,
      lng: true,
      note: true,
      createdBy: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ marker }, { status: 201 });
}
