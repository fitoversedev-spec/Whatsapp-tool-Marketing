// Admin set/clear for a sport's "project drive link" (Setting key
// project_drive_link_<sport>) — shown alongside a real project photo on the
// new showcase page between "The Fitoverse Advantage" and "Connect With Us"
// in the quotation PDF. One fixed link per sport, reused on every quote.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSportMeta } from "@/lib/catalogue/sport-meta";

export const runtime = "nodejs";

const bodySchema = z.object({ url: z.string().trim().max(500) });

export async function POST(req: NextRequest, { params }: { params: { sport: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const meta = getSportMeta(params.sport);
  if (!meta) return NextResponse.json({ error: "unknown_sport" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const key = `project_drive_link_${params.sport}`;
  if (!parsed.data.url) {
    await prisma.setting.delete({ where: { key } }).catch(() => null);
    return NextResponse.json({ ok: true, url: null });
  }
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: parsed.data.url },
    update: { value: parsed.data.url },
  });
  return NextResponse.json({ ok: true, url: parsed.data.url });
}
