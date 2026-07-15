// Read-only audit trail (spec §13: MANAGEMENT + ADMIN only). Filterable by
// entity type and actor; paginated (audit tables grow unbounded).
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isManagementOrAbove } from "@/lib/rbac";

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isManagementOrAbove(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const entity = searchParams.get("entity");
  const actorId = searchParams.get("actorId");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const where: Record<string, unknown> = {
    ...(entity ? { entity } : {}),
    ...(actorId ? { actorId } : {}),
  };

  const [rows, total, entities] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { actor: { select: { id: true, name: true } } },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } }),
  ]);

  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      entity: r.entity,
      entityId: r.entityId,
      action: r.action,
      diff: r.diff,
      at: r.at.toISOString(),
      actorName: r.actor?.name ?? null,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    entities: entities.map((e) => e.entity),
  });
}
