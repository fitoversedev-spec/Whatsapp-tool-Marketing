// Single audit-write chokepoint (spec §3.2/§14) — every call site imports
// this rather than writing prisma.auditLog.create() directly, so the shape
// stays consistent. Best-effort: an audit-write failure must never fail the
// mutation it's describing.
import { prisma } from "@/lib/prisma";

export type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "STAGE_CHANGE" | "SEND";

export async function writeAudit(args: {
  actorId: string | null;
  entity: string;
  entityId: string;
  action: AuditAction;
  diff?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog
    .create({
      data: {
        actorId: args.actorId,
        entity: args.entity,
        entityId: args.entityId,
        action: args.action,
        diff: args.diff ? JSON.stringify(args.diff) : null,
      },
    })
    .catch((err) => console.error("[audit] write failed", err));
}
