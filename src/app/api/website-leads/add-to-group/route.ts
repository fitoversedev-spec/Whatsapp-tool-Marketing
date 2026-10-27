// Put ticked website leads into a broadcast group (the list's "Add to group").
// Each lead's phone becomes (or matches) a WhatsApp marketing contact and joins
// the group, exactly like ad leads do. Open to all signed-in users, like the
// group routes. Body: { leadIds, groupId } for an existing group, or
// { leadIds, newGroupName } to make a new one. Response: { ok, group, result: { added, alreadyIn, noPhone } }.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_LEADS_PER_REQUEST, addPeopleToGroup, createBroadcastGroup } from "@/lib/broadcast-groups";

const schema = z
  .object({
    leadIds: z.array(z.string().uuid()).min(1).max(MAX_LEADS_PER_REQUEST),
    groupId: z.string().uuid().optional(),
    newGroupName: z.string().min(1).max(200).optional(),
  })
  .refine((b) => !!b.groupId !== !!b.newGroupName, { message: "send groupId or newGroupName" });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { leadIds, groupId, newGroupName } = parsed.data;

  let group: { id: string; name: string };
  if (groupId) {
    const found = await prisma.broadcastGroup.findUnique({ where: { id: groupId }, select: { id: true, name: true } });
    if (!found) return NextResponse.json({ error: "This group no longer exists" }, { status: 404 });
    group = found;
  } else {
    const made = await createBroadcastGroup(newGroupName!, user.id);
    if (made.kind === "invalid_name") return NextResponse.json({ error: made.error }, { status: 400 });
    if (made.kind === "exists") {
      return NextResponse.json({ error: made.error, ...(made.group ? { group: made.group } : {}) }, { status: 409 });
    }
    group = made.group;
  }

  const result = await addPeopleToGroup(group.id, { websiteLeadIds: leadIds }, user.id);
  return NextResponse.json({ ok: true, group, result });
}
