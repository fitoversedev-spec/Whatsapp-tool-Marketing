// A contact's Next actions — as many as needed, no deal required. A dated one
// also gets an in-app/push alert for the rep handling the customer
// (syncNextActionReminder keeps that Reminder in step).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadContactForUser } from "@/lib/crm/contactAccess";
import { syncNextActionReminder } from "@/lib/crm/nextActions";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadContactForUser(params.id, user, "view");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const nextActions = await prisma.contactNextAction.findMany({
    where: { accountContactId: params.id, deletedAt: null },
    orderBy: [{ doneAt: { sort: "asc", nulls: "first" } }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    include: { createdBy: { select: { name: true } }, doneBy: { select: { name: true } } },
  });
  return NextResponse.json({ nextActions });
}

const createSchema = z.object({
  text: z.string().trim().min(1).max(500),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadContactForUser(params.id, user, "edit");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const action = await prisma.contactNextAction.create({
    data: {
      accountContactId: params.id,
      text: parsed.data.text,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      createdByUserId: user.id,
    },
  });
  await syncNextActionReminder(action.id);
  return NextResponse.json({ nextAction: action });
}
