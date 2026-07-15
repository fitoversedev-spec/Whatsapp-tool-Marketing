import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { TAXONOMY_TYPES, listTaxonomy, createTaxonomyRow, type TaxonomyType } from "@/lib/taxonomy";
import { writeAudit } from "@/lib/audit";

function isValidType(t: string): t is TaxonomyType {
  return (TAXONOMY_TYPES as readonly string[]).includes(t);
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  stageType: z.enum(["active", "won", "lost"]).optional(),
  probabilityPercent: z.number().int().min(0).max(100).nullable().optional(),
  slaHours: z.number().int().min(0).max(9999).nullable().optional(),
  requiresLossReason: z.boolean().optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { type: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isValidType(params.type)) return NextResponse.json({ error: "unknown_type" }, { status: 404 });

  const rows = await listTaxonomy(params.type);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest, { params }: { params: { type: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isValidType(params.type)) return NextResponse.json({ error: "unknown_type" }, { status: 404 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const row = await createTaxonomyRow(params.type, parsed.data);
  await writeAudit({
    actorId: user.id,
    entity: params.type,
    entityId: (row as { id: string }).id,
    action: "CREATE",
    diff: parsed.data,
  });
  return NextResponse.json({ row });
}
