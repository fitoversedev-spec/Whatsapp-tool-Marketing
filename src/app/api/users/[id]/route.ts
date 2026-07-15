import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  role: z.enum(["admin", "sales", "manager", "management"]).optional(),
  approvalStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  rejectionReason: z.string().max(500).nullable().optional(),
  officeId: z.string().uuid().nullable().optional(),
  deleted: z.boolean().optional(), // true = soft delete, false = restore
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (me.id === params.id) {
    return NextResponse.json({ error: "You cannot modify your own account here." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const patch: any = { ...parsed.data };

  // Translate `deleted` boolean -> deletedAt timestamp
  if ("deleted" in patch) {
    patch.deletedAt = patch.deleted ? new Date() : null;
    delete patch.deleted;
  }

  // Clear rejection reason when transitioning to approved
  if (patch.approvalStatus === "approved") {
    patch.rejectionReason = null;
  }

  await prisma.user.update({ where: { id: params.id }, data: patch });
  await writeAudit({ actorId: me.id, entity: "User", entityId: params.id, action: "UPDATE", diff: patch });
  return NextResponse.json({ ok: true });
}
