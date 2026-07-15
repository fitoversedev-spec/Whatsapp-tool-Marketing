import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { TAXONOMY_TYPES, updateTaxonomyRow, wouldRemoveLastStageOfType, type TaxonomyType } from "@/lib/taxonomy";
import { writeAudit } from "@/lib/audit";

function isValidType(t: string): t is TaxonomyType {
  return (TAXONOMY_TYPES as readonly string[]).includes(t);
}

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
  stageType: z.enum(["active", "won", "lost"]).optional(),
  probabilityPercent: z.number().int().min(0).max(100).nullable().optional(),
  slaHours: z.number().int().min(0).max(9999).nullable().optional(),
  requiresLossReason: z.boolean().optional(),
  parentId: z.string().uuid().nullable().optional(),
  deleted: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { type: string; id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isValidType(params.type)) return NextResponse.json({ error: "unknown_type" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  // Spec §5.2: at least one WON and one LOST FunnelStage must always exist —
  // block deactivating the last one of either type.
  if (params.type === "funnel-stages" && (parsed.data.deleted || parsed.data.isActive === false)) {
    for (const t of ["won", "lost"] as const) {
      if (await wouldRemoveLastStageOfType(params.id, t)) {
        return NextResponse.json(
          { error: `Can't deactivate the last "${t}" stage — at least one must always exist.` },
          { status: 422 },
        );
      }
    }
  }

  const row = await updateTaxonomyRow(params.type, params.id, parsed.data);
  await writeAudit({
    actorId: user.id,
    entity: params.type,
    entityId: params.id,
    action: parsed.data.deleted ? "DELETE" : "UPDATE",
    diff: parsed.data,
  });
  return NextResponse.json({ row });
}
