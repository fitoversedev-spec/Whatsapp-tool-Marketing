// Keeps a contact next action's alert Reminder in step with it. An open, dated
// next action has exactly one Reminder — owned by the rep handling the customer
// so it reaches them in Reminders / My Day and as a push. Done, undated or
// deleted ones have none open. In-app only: WhatsApp reminders are switched off.
import { prisma } from "@/lib/prisma";
import { logContactEvent, describeChanges, excerpt } from "./contactEvents";

const MESSAGE_PREFIX = "Next action: ";

// Only the Fitoverse AI Sales Agent passes these, and only when it creates a
// next action: the alert must reach a named human (never the AI's service
// user), and an escalation is flagged high priority. Human callers omit them
// and nothing about their behaviour changes.
export type ReminderOptions = { ownerUserId?: string; priority?: "HIGH" | "MEDIUM" | "LOW" };

export async function syncNextActionReminder(actionId: string, opts?: ReminderOptions): Promise<void> {
  const action = await prisma.contactNextAction.findUnique({
    where: { id: actionId },
    include: {
      reminder: { select: { id: true, dueAt: true, completedAt: true, notifiedAt: true, ownerUserId: true } },
      accountContact: { select: { account: { select: { ownerUserId: true } } } },
      createdBy: { select: { role: true } },
    },
  });
  if (!action) return;
  const reminder = action.reminder;

  if (action.deletedAt || !action.dueAt) {
    if (reminder) await prisma.reminder.delete({ where: { id: reminder.id } }).catch(() => null);
    return;
  }

  if (action.doneAt) {
    if (reminder && !reminder.completedAt) {
      await prisma.reminder.update({ where: { id: reminder.id }, data: { completedAt: action.doneAt, status: "DONE" } });
    }
    return;
  }

  // A next action the AI created keeps the human it was addressed to (an
  // escalation target can differ from the customer's rep); every other next
  // action follows the rep handling the customer, as always.
  const accountOwner = action.accountContact.account.ownerUserId;
  const ownerUserId =
    action.createdBy.role === "ai_agent"
      ? (reminder?.ownerUserId ?? opts?.ownerUserId ?? accountOwner ?? action.createdByUserId)
      : (accountOwner ?? action.createdByUserId);
  const message = `${MESSAGE_PREFIX}${action.text}`.slice(0, 500);

  if (reminder) {
    const rescheduled = reminder.dueAt.getTime() !== action.dueAt.getTime();
    await prisma.reminder.update({
      where: { id: reminder.id },
      data: {
        message,
        ownerUserId,
        dueAt: action.dueAt,
        completedAt: null,
        ...(rescheduled ? { notifiedAt: null, status: "PENDING" } : { status: reminder.notifiedAt ? "SENT" : "PENDING" }),
      },
    });
    return;
  }

  const taskType = await prisma.activityType.findFirst({ where: { name: "Task", deletedAt: null }, select: { id: true } });
  const created = await prisma.reminder.create({
    data: {
      accountContactId: action.accountContactId,
      ownerUserId,
      message,
      dueAt: action.dueAt,
      channels: ["in_app"],
      activityTypeId: taskType?.id ?? null,
      ...(opts?.priority ? { priority: opts.priority } : {}),
    },
  });
  await prisma.contactNextAction.update({ where: { id: action.id }, data: { reminderId: created.id } });
}

// The other direction: a next action's reminder was completed or reopened
// from somewhere else (Reminders page, My Day) — tick the next action to match.
export async function syncNextActionFromReminder(reminderId: string, completed: boolean, actorUserId: string): Promise<void> {
  const action = await prisma.contactNextAction.findUnique({ where: { reminderId } });
  if (!action || action.deletedAt || !!action.doneAt === completed) return;
  await prisma.contactNextAction.update({
    where: { id: action.id },
    data: completed ? { doneAt: new Date(), doneByUserId: actorUserId } : { doneAt: null, doneByUserId: null },
  });
  await logContactEvent({
    contactId: action.accountContactId,
    actorUserId,
    kind: completed ? "next_action_done" : "next_action_reopened",
    summary: `${completed ? "Next action done" : "Next action reopened"}: ${excerpt(action.text)}`,
    refId: action.id,
  });
}

// ── create / edit one next action ───────────────────────────────────────────
// Shared by the contact's Next actions routes and the AI Sales Agent API so
// both write the same rows, reminders and Timeline entries.

export async function createNextAction(args: {
  contactId: string;
  text: string;
  dueAt: Date | null;
  createdByUserId: string;
  reminder?: ReminderOptions;
}) {
  const action = await prisma.contactNextAction.create({
    data: {
      accountContactId: args.contactId,
      text: args.text,
      dueAt: args.dueAt,
      createdByUserId: args.createdByUserId,
    },
  });
  await syncNextActionReminder(action.id, args.reminder);
  return action;
}

function fmtDue(d: Date | null): string | null {
  return d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;
}

type NextActionRow = NonNullable<Awaited<ReturnType<typeof prisma.contactNextAction.findUnique>>>;

// Edit, tick done or reopen one next action: updates the row, mirrors it onto
// its alert Reminder and records it on the contact Timeline. Returns the row
// unchanged when the patch changes nothing.
export async function updateNextAction(args: {
  before: NextActionRow;
  patch: { text?: string; dueAt?: string | null; done?: boolean };
  actorUserId: string;
}): Promise<NextActionRow> {
  const { before, patch, actorUserId } = args;
  const data: Record<string, unknown> = {};
  const nextText = patch.text ?? before.text;
  const nextDue = patch.dueAt !== undefined ? (patch.dueAt ? new Date(patch.dueAt) : null) : before.dueAt;
  if (nextText !== before.text) data.text = nextText;
  if ((nextDue?.getTime() ?? null) !== (before.dueAt?.getTime() ?? null)) data.dueAt = nextDue;
  const toggled = patch.done !== undefined && patch.done !== !!before.doneAt;
  if (toggled) {
    data.doneAt = patch.done ? new Date() : null;
    data.doneByUserId = patch.done ? actorUserId : null;
  }
  if (!Object.keys(data).length) return before;

  const updated = await prisma.contactNextAction.update({ where: { id: before.id }, data });
  await syncNextActionReminder(updated.id);

  const edits = describeChanges([
    ["Action", before.text, nextText],
    ["Due", fmtDue(before.dueAt), fmtDue(nextDue)],
  ]);
  if (edits.length) {
    await logContactEvent({
      contactId: before.accountContactId,
      actorUserId,
      kind: "next_action_edited",
      summary: `Next action edited — ${excerpt(nextText)}`,
      detail: edits.join("\n"),
      refId: updated.id,
    });
  }
  if (toggled) {
    await logContactEvent({
      contactId: before.accountContactId,
      actorUserId,
      kind: patch.done ? "next_action_done" : "next_action_reopened",
      summary: `${patch.done ? "Next action done" : "Next action reopened"} — ${excerpt(nextText)}`,
      refId: updated.id,
    });
  }
  return updated;
}
