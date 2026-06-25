import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { type StageType } from "@/lib/pipeline";
import { getPipelineStages, setPipelineStages } from "@/lib/pipeline-server";

const stageSchema = z.object({
  id: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/, "lowercase alphanumeric + underscore only"),
  label: z.string().min(1).max(40),
  color: z.enum(["slate", "blue", "purple", "amber", "orange", "emerald", "red"]),
  type: z.enum(["active", "won", "lost"]),
  order: z.number().int().min(0).max(99),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const stages = await getPipelineStages();
  return NextResponse.json({ stages });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = z.array(stageSchema).min(2).max(20).safeParse(body?.stages);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_stages", details: parsed.error.flatten() }, { status: 400 });
  }
  const ids = new Set<string>();
  for (const s of parsed.data) {
    if (ids.has(s.id)) {
      return NextResponse.json({ error: `Duplicate stage id: ${s.id}` }, { status: 400 });
    }
    ids.add(s.id);
  }
  const hasWon = parsed.data.some((s) => (s.type as StageType) === "won");
  const hasLost = parsed.data.some((s) => (s.type as StageType) === "lost");
  if (!hasWon || !hasLost) {
    return NextResponse.json(
      { error: "At least one 'won' and one 'lost' stage required" },
      { status: 400 }
    );
  }
  await setPipelineStages(parsed.data);
  return NextResponse.json({ ok: true });
}
