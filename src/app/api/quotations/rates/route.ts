// Read + update default rate sheet for a given sport. Both admin and sales
// can edit per the product spec ("editable by admin and sales also").
// Sport selector is the ?sport= query param on GET, and `sport` field in
// the PUT body. Defaults to "football" for back-compat with old callers.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  getRatesForSport,
  setRatesForSport,
  SUPPORTED_SPORTS,
  type Sport,
} from "@/lib/quotation/rates";

const itemSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  description: z.string().max(4000),
  areaMode: z.enum(["plot", "wrap", "per_piece", "perimeter"]),
  defaultRate: z.number().min(0).max(10_000_000),
  gstPercent: z.number().min(0).max(100),
  wrapHeightFt: z.number().min(0).max(1000).optional(),
  optional: z.boolean().optional(),
});

const sportSchema = z.enum(SUPPORTED_SPORTS as [Sport, ...Sport[]]);

const putSchema = z.object({
  sport: sportSchema.optional().default("football"),
  items: z.array(itemSchema).min(1).max(50),
});

function parseSport(req: NextRequest): Sport {
  const raw = req.nextUrl.searchParams.get("sport") ?? "football";
  const parsed = sportSchema.safeParse(raw);
  return parsed.success ? parsed.data : "football";
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sport = parseSport(req);
  const items = await getRatesForSport(sport);
  return NextResponse.json({ sport, items });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  await setRatesForSport(parsed.data.sport, parsed.data.items);
  return NextResponse.json({ ok: true, sport: parsed.data.sport });
}
