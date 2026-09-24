import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const activityIds: string[] = [];
  const reminderIds: string[] = [];
  for (const id of parsed.data.ids) {
    if (id.startsWith("activity:")) activityIds.push(id.slice("activity:".length));
    else if (id.startsWith("reminder:")) reminderIds.push(id.slice("reminder:".length));
  }

  const admin = isAdmin(user.role);
  let deleted = 0;

  if (activityIds.length) {
    const where = admin
      ? { id: { in: activityIds } }
      : { id: { in: activityIds }, ownerUserId: user.id };
    const result = await prisma.activity.deleteMany({ where });
    deleted += result.count;
  }

  if (reminderIds.length) {
    const where = admin
      ? { id: { in: reminderIds } }
      : { id: { in: reminderIds }, ownerUserId: user.id };
    const result = await prisma.reminder.deleteMany({ where });
    deleted += result.count;
  }

  return NextResponse.json({ deleted });
}
