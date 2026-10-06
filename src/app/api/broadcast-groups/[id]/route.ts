// Rename or delete one broadcast group. Only the group's maker or an admin may
// do either. Deleting a group removes the list only — its contacts stay in
// WhatsApp contacts, and broadcasts already sent keep their recipients.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GROUP_NAME_MAX, canEditGroup, findGroupByName, tidyGroupName } from "@/lib/broadcast-groups";

const patchSchema = z.object({ name: z.string().min(1).max(200) });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const group = await prisma.broadcastGroup.findUnique({
    where: { id: params.id },
    select: { id: true, createdByUserId: true },
  });
  if (!group) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEditGroup(user, group)) {
    return NextResponse.json({ error: "Only the person who made this group or an admin can rename it" }, { status: 403 });
  }

  const name = tidyGroupName(parsed.data.name);
  if (!name) return NextResponse.json({ error: "Give the group a name" }, { status: 400 });
  if (name.length > GROUP_NAME_MAX) {
    return NextResponse.json({ error: `Group names can be up to ${GROUP_NAME_MAX} characters` }, { status: 400 });
  }
  const clash = await findGroupByName(name, group.id);
  if (clash) return NextResponse.json({ error: `A group called "${clash.name}" already exists` }, { status: 409 });

  try {
    const updated = await prisma.broadcastGroup.update({
      where: { id: group.id },
      data: { name },
      select: { id: true, name: true },
    });
    return NextResponse.json({ ok: true, group: updated });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: `A group called "${name}" already exists` }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const group = await prisma.broadcastGroup.findUnique({
    where: { id: params.id },
    select: { id: true, createdByUserId: true },
  });
  if (!group) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEditGroup(user, group)) {
    return NextResponse.json({ error: "Only the person who made this group or an admin can delete it" }, { status: 403 });
  }

  // Members cascade with the group; the contacts themselves are untouched.
  await prisma.broadcastGroup.delete({ where: { id: group.id } });
  return NextResponse.json({ ok: true });
}
