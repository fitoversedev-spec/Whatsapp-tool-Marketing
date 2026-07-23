// Admin-only target data entry (Phase 1 analytics v2 — spec §11.3 Targets
// sub-view). Genuine admin CRUD, not analytics viewing, so this gates on
// isAdmin() + 403 like every other admin API route in this codebase
// (admin/taxonomy/[type], admin/audit-log) — requireAdmin() itself calls
// next/navigation's redirect(), which is for pages, not JSON API routes.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { upsertTarget, listTargets } from "@/lib/analytics/targets";
import { writeAudit } from "@/lib/audit";

const SCOPE_TYPES = ["USER", "COMPANY"] as const;
const PERIOD_TYPES = ["MONTH", "QUARTER", "FY"] as const;

const upsertSchema = z
  .object({
    scopeType: z.enum(SCOPE_TYPES),
    scopeId: z.string().uuid().nullable(),
    periodType: z.enum(PERIOD_TYPES),
    periodStart: z.string().min(1),
    targetRevenue: z.number().min(0),
    targetDeals: z.number().int().min(0).nullable().optional(),
  })
  // COMPANY-scope rows always carry a null scopeId (Target's own unique
  // index treats scopeId as part of the row's identity) — a USER-scope row
  // with no scopeId would silently collide with the COMPANY row instead.
  .refine((v) => (v.scopeType === "USER" ? v.scopeId != null : v.scopeId == null), {
    message: "scopeId is required for USER scope and must be null for COMPANY scope",
    path: ["scopeId"],
  });

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const scopeTypeParam = req.nextUrl.searchParams.get("scopeType");
  if (scopeTypeParam && !(SCOPE_TYPES as readonly string[]).includes(scopeTypeParam)) {
    return NextResponse.json({ error: "invalid_scope_type" }, { status: 400 });
  }

  const targets = await listTargets(scopeTypeParam as (typeof SCOPE_TYPES)[number] | undefined);
  return NextResponse.json({
    targets: targets.map((t) => ({
      id: t.id,
      scopeType: t.scopeType,
      scopeId: t.scopeId,
      periodType: t.periodType,
      periodStart: t.periodStart.toISOString(),
      targetRevenue: Number(t.targetRevenue),
      targetDeals: t.targetDeals,
      setByUserId: t.setByUserId,
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
}

async function handleUpsert(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = upsertSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const periodStart = new Date(parsed.data.periodStart + "T00:00:00");
  if (Number.isNaN(periodStart.getTime())) {
    return NextResponse.json({ error: "invalid_period_start" }, { status: 400 });
  }

  await upsertTarget({
    scopeType: parsed.data.scopeType,
    scopeId: parsed.data.scopeId,
    periodType: parsed.data.periodType,
    periodStart,
    targetRevenue: parsed.data.targetRevenue,
    targetDeals: parsed.data.targetDeals ?? null,
    setByUserId: user.id,
  });

  await writeAudit({
    actorId: user.id,
    entity: "target",
    entityId: `${parsed.data.scopeType}:${parsed.data.scopeId ?? "company"}:${parsed.data.periodType}:${parsed.data.periodStart}`,
    action: "UPDATE",
    diff: parsed.data,
  });

  return NextResponse.json({ ok: true });
}

export const POST = handleUpsert;
export const PUT = handleUpsert;
