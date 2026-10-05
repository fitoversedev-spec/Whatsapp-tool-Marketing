// Assign (or change) the rep handling this customer — admins and managers only.
// See reassignCustomerRep() for what follows the customer to the new rep.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageAllCustomers } from "@/lib/rbac";
import { loadContactForUser } from "@/lib/crm/contactAccess";
import { reassignCustomerRep } from "@/lib/crm/assignRep";

const schema = z.object({ userId: z.string().uuid().nullable() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageAllCustomers(user.role)) {
    return NextResponse.json({ error: "Only admins and managers can assign a rep" }, { status: 403 });
  }

  const res = await loadContactForUser(params.id, user, "edit");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  if (parsed.data.userId) {
    const target = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
    if (!target || target.deletedAt || !target.isActive || target.approvalStatus !== "approved") {
      return NextResponse.json({ error: "That user isn't available" }, { status: 422 });
    }
  }

  const result = await reassignCustomerRep({ accountId: res.contact.accountId, toUserId: parsed.data.userId, actorUserId: user.id });
  return NextResponse.json({ ok: true, changed: result.changed });
}
