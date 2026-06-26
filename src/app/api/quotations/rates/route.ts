// Read + update the default rate sheet. Both admin and sales can edit per
// the product spec ("editable by admin and sales also").

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getFootballRates, setFootballRates } from "@/lib/quotation/rates";

const itemSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  description: z.string().max(4000),
  areaMode: z.enum(["plot", "wrap", "per_piece"]),
  defaultRate: z.number().min(0).max(1_000_000),
  gstPercent: z.number().min(0).max(100),
  wrapHeightFt: z.number().min(0).max(1000).optional(),
  optional: z.boolean().optional(),
});

const putSchema = z.object({
  items: z.array(itemSchema).min(1).max(50),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const items = await getFootballRates();
  return NextResponse.json({ items });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  await setFootballRates(parsed.data.items);
  return NextResponse.json({ ok: true });
}
