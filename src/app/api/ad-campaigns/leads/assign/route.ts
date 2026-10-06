// Assign many captured Meta ad leads to one rep at once (the lead list's tick
// boxes → "Assign to rep"). Admins and managers only. assignedToUserId null
// takes the rep off. Like the one-lead assignee change in ../[id], the leads'
// open reminders move to the new rep (or to whoever un-assigns them). The rep
// is not messaged — they find the leads with the list's "Assigned To" filter.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isManagerOrAbove } from "@/lib/rbac";
import { MAX_LEADS_PER_REQUEST } from "@/lib/broadcast-groups";

const schema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(MAX_LEADS_PER_REQUEST),
  assignedToUserId: z.string().uuid().nullable(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isManagerOrAbove(user.role)) {
    return NextResponse.json({ error: "Only admins and managers can assign leads in bulk" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { leadIds, assignedToUserId } = parsed.data;

  let repName: string | null = null;
  if (assignedToUserId) {
    // Same rep list the picker shows (active, approved, not deleted).
    const rep = await prisma.user.findFirst({
      where: { id: assignedToUserId, deletedAt: null, isActive: true, approvalStatus: "approved" },
      select: { name: true },
    });
    if (!rep) return NextResponse.json({ error: "That rep can't be assigned leads" }, { status: 400 });
    repName = rep.name;
  }

  const updated = await prisma.$transaction(
    async (tx) => {
      const res = await tx.metaLead.updateMany({
        where: { id: { in: leadIds } },
        data: { assignedToUserId },
      });
      await tx.reminder.updateMany({
        where: { metaLeadId: { in: leadIds }, completedAt: null },
        data: { ownerUserId: assignedToUserId ?? user.id },
      });
      return res.count;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  return NextResponse.json({ ok: true, updated, assignedToUserId, assignedToName: repName });
}
