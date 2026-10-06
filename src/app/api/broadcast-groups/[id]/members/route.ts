// Members of one broadcast group.
//   POST   { metaLeadIds } — add ticked Meta ad leads (anyone on the team).
//   DELETE { contactIds }  — remove people (the group's maker or an admin only).
// Removing someone takes them out of this group only; they stay in WhatsApp
// contacts and in any other group.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_LEADS_PER_REQUEST, addMetaLeadsToGroup, canEditGroup } from "@/lib/broadcast-groups";

const addSchema = z.object({
  metaLeadIds: z.array(z.string().uuid()).min(1).max(MAX_LEADS_PER_REQUEST),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const group = await prisma.broadcastGroup.findUnique({ where: { id: params.id }, select: { id: true, name: true } });
  if (!group) return NextResponse.json({ error: "This group no longer exists" }, { status: 404 });

  const result = await addMetaLeadsToGroup(group.id, parsed.data.metaLeadIds, user.id);
  return NextResponse.json({ ok: true, group, result });
}

const removeSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(MAX_LEADS_PER_REQUEST),
});

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = removeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const group = await prisma.broadcastGroup.findUnique({
    where: { id: params.id },
    select: { id: true, createdByUserId: true },
  });
  if (!group) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEditGroup(user, group)) {
    return NextResponse.json(
      { error: "Only the person who made this group or an admin can remove people from it" },
      { status: 403 },
    );
  }

  const removed = await prisma.broadcastGroupMember.deleteMany({
    where: { groupId: group.id, contactId: { in: parsed.data.contactIds } },
  });
  if (removed.count > 0) {
    await prisma.broadcastGroup.update({ where: { id: group.id }, data: { updatedAt: new Date() } });
  }
  return NextResponse.json({ ok: true, removed: removed.count });
}
