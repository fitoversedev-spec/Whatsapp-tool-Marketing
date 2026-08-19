// Court-designer material sizes API — the sales-editable roll/tile dimensions +
// wastage % used by the flooring calculator (see src/lib/court-image/
// material-config.ts). Stored in the `settings` table so the values persist and
// are reused across sessions/users.
//
// GET  /api/court-images/material-sizes — returns the current sizes (defaults-
//                                          filled). Any authenticated user.
// POST /api/court-images/material-sizes — body: any subset of the size fields —
//                                          validates + persists. Any authenticated
//                                          user (401 if none).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getMaterialSizes,
  setMaterialSizes,
  type MaterialSizes,
} from "@/lib/court-image/material-config";

export const runtime = "nodejs";

// Which fields may be > 0 vs >= 0. Roll/tile SIZES are divisors, so they must be
// strictly positive; thickness + wastage may legitimately be 0.
const FIELD_RULES: Record<keyof MaterialSizes, { min: number; inclusive: boolean }> = {
  turfRollWidthM: { min: 0, inclusive: false },
  turfRollLengthM: { min: 0, inclusive: false },
  pvcRollWidthM: { min: 0, inclusive: false },
  pvcRollLengthM: { min: 0, inclusive: false },
  ppTileCm: { min: 0, inclusive: false },
  ppTileThicknessMm: { min: 0, inclusive: true },
  wastagePct: { min: 0, inclusive: true },
};

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sizes = await getMaterialSizes();
  return NextResponse.json({ sizes });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const partial: Partial<MaterialSizes> = {};
  for (const key of Object.keys(FIELD_RULES) as (keyof MaterialSizes)[]) {
    const raw = (body as Record<string, unknown>)[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(raw);
    const rule = FIELD_RULES[key];
    const ok =
      Number.isFinite(n) && (rule.inclusive ? n >= rule.min : n > rule.min);
    if (!ok) {
      return NextResponse.json(
        { error: `invalid value for ${key}` },
        { status: 400 }
      );
    }
    partial[key] = n;
  }

  if (Object.keys(partial).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  await setMaterialSizes(partial);
  const sizes = await getMaterialSizes();
  return NextResponse.json({ ok: true, sizes });
}
