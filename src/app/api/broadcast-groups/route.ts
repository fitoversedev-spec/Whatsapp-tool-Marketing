// Broadcast groups — list every group (they're shared by the whole team) and
// create one, optionally filling it in the same call with ticked Meta ad leads
// (a lead list's "Add to group" → "New group") and/or WhatsApp contacts (the
// Contacts page's "Add to group", or the Groups tab's "New group" picker).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  GROUP_NAME_MAX,
  MAX_LEADS_PER_REQUEST,
  addPeopleToGroup,
  findGroupByName,
  tidyGroupName,
} from "@/lib/broadcast-groups";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const groups = await prisma.broadcastGroup.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      createdByUserId: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { name: true } },
      _count: { select: { members: true } },
    },
  });

  return NextResponse.json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      memberCount: g._count.members,
      createdByUserId: g.createdByUserId,
      createdByName: g.createdBy.name,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
    })),
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  metaLeadIds: z.array(z.string().uuid()).max(MAX_LEADS_PER_REQUEST).optional(),
  contactIds: z.array(z.string().uuid()).max(MAX_LEADS_PER_REQUEST).optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const name = tidyGroupName(parsed.data.name);
  if (!name) return NextResponse.json({ error: "Give the group a name" }, { status: 400 });
  if (name.length > GROUP_NAME_MAX) {
    return NextResponse.json({ error: `Group names can be up to ${GROUP_NAME_MAX} characters` }, { status: 400 });
  }

  const clash = await findGroupByName(name);
  if (clash) {
    return NextResponse.json({ error: `A group called "${clash.name}" already exists`, group: clash }, { status: 409 });
  }

  let group: { id: string; name: string };
  try {
    group = await prisma.broadcastGroup.create({
      data: { name, createdByUserId: user.id },
      select: { id: true, name: true },
    });
  } catch (err) {
    // Two people creating the same name at once — the unique index wins.
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: `A group called "${name}" already exists` }, { status: 409 });
    }
    throw err;
  }

  const result = await addPeopleToGroup(
    group.id,
    { metaLeadIds: parsed.data.metaLeadIds, contactIds: parsed.data.contactIds },
    user.id,
  );

  return NextResponse.json({ ok: true, group, result });
}
