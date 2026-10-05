// Edit, tick done / reopen, or delete one next action. Every change is recorded
// on the contact Timeline and mirrored onto its alert Reminder.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadContactForUser } from "@/lib/crm/contactAccess";
import { syncNextActionReminder } from "@/lib/crm/nextActions";
import { logContactEvent, describeChanges, excerpt } from "@/lib/crm/contactEvents";

async function loadAction(params: { id: string; actionId: string }, user: { id: string; role: string }) {
  const res = await loadContactForUser(params.id, user, "edit");
  if (!("contact" in res)) return res;
  const action = await prisma.contactNextAction.findUnique({ where: { id: params.actionId } });
  if (!action || action.deletedAt || action.accountContactId !== params.id) return { error: "not_found" as const, status: 404 };
  return { action };
}

function fmtDue(d: Date | null): string | null {
  return d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;
}

const patchSchema = z.object({
  text: z.string().trim().min(1).max(500).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  done: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string; actionId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadAction(params, user);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  const before = res.action;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const data: Record<string, unknown> = {};
  const nextText = parsed.data.text ?? before.text;
  const nextDue = parsed.data.dueAt !== undefined ? (parsed.data.dueAt ? new Date(parsed.data.dueAt) : null) : before.dueAt;
  if (nextText !== before.text) data.text = nextText;
  if ((nextDue?.getTime() ?? null) !== (before.dueAt?.getTime() ?? null)) data.dueAt = nextDue;
  const toggled = parsed.data.done !== undefined && parsed.data.done !== !!before.doneAt;
  if (toggled) {
    data.doneAt = parsed.data.done ? new Date() : null;
    data.doneByUserId = parsed.data.done ? user.id : null;
  }
  if (!Object.keys(data).length) return NextResponse.json({ nextAction: before });

  const updated = await prisma.contactNextAction.update({ where: { id: before.id }, data });
  await syncNextActionReminder(updated.id);

  const edits = describeChanges([
    ["Action", before.text, nextText],
    ["Due", fmtDue(before.dueAt), fmtDue(nextDue)],
  ]);
  if (edits.length) {
    await logContactEvent({
      contactId: params.id,
      actorUserId: user.id,
      kind: "next_action_edited",
      summary: `Next action edited — ${excerpt(nextText)}`,
      detail: edits.join("\n"),
      refId: updated.id,
    });
  }
  if (toggled) {
    await logContactEvent({
      contactId: params.id,
      actorUserId: user.id,
      kind: parsed.data.done ? "next_action_done" : "next_action_reopened",
      summary: `${parsed.data.done ? "Next action done" : "Next action reopened"} — ${excerpt(nextText)}`,
      refId: updated.id,
    });
  }
  return NextResponse.json({ nextAction: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; actionId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadAction(params, user);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  await prisma.contactNextAction.update({ where: { id: res.action.id }, data: { deletedAt: new Date() } });
  await syncNextActionReminder(res.action.id);
  await logContactEvent({
    contactId: params.id,
    actorUserId: user.id,
    kind: "next_action_deleted",
    summary: `Next action deleted — ${excerpt(res.action.text)}`,
    refId: res.action.id,
  });
  return NextResponse.json({ ok: true });
}
