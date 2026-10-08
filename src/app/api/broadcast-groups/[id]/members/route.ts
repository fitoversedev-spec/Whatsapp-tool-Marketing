// Members of one broadcast group.
//   POST   { metaLeadIds?, contactIds? } — add ticked Meta ad leads and/or
//          WhatsApp contacts (anyone on the team).
//   DELETE { contactIds } — remove people (the group's maker or an admin only).
// Removing someone takes them out of this group only; they stay in WhatsApp
// contacts and in any other group.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  MAX_CONTACTS_PER_REQUEST,
  MAX_LEADS_PER_REQUEST,
  addPeopleToGroup,
  canEditGroup,
  chunkIds,
} from "@/lib/broadcast-groups";

const addSchema = z
  .object({
    metaLeadIds: z.array(z.string().uuid()).max(MAX_LEADS_PER_REQUEST).optional(),
    contactIds: z.array(z.string().uuid()).max(MAX_CONTACTS_PER_REQUEST).optional(),
  })
  .refine((b) => (b.metaLeadIds?.length ?? 0) + (b.contactIds?.length ?? 0) > 0, { message: "nobody to add" });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const group = await prisma.broadcastGroup.findUnique({ where: { id: params.id }, select: { id: true, name: true } });
  if (!group) return NextResponse.json({ error: "This group no longer exists" }, { status: 404 });

  const result = await addPeopleToGroup(group.id, parsed.data, user.id);
  return NextResponse.json({ ok: true, group, result });
}

const removeSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(MAX_CONTACTS_PER_REQUEST),
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

  const results = await prisma.$transaction(
    chunkIds(parsed.data.contactIds).map((part) =>
      prisma.broadcastGroupMember.deleteMany({ where: { groupId: group.id, contactId: { in: part } } }),
    ),
  );
  const removed = results.reduce((n, r) => n + r.count, 0);
  if (removed > 0) {
    await prisma.broadcastGroup.update({ where: { id: group.id }, data: { updatedAt: new Date() } });
  }
  return NextResponse.json({ ok: true, removed });
}
