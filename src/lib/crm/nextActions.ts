// Keeps a contact next action's alert Reminder in step with it. An open, dated
// next action has exactly one Reminder — owned by the rep handling the customer
// so it reaches them in Reminders / My Day and as a push. Done, undated or
// deleted ones have none open. In-app only: WhatsApp reminders are switched off.
import { prisma } from "@/lib/prisma";
import { logContactEvent, excerpt } from "./contactEvents";

const MESSAGE_PREFIX = "Next action: ";

export async function syncNextActionReminder(actionId: string): Promise<void> {
  const action = await prisma.contactNextAction.findUnique({
    where: { id: actionId },
    include: {
      reminder: { select: { id: true, dueAt: true, completedAt: true, notifiedAt: true } },
      accountContact: { select: { account: { select: { ownerUserId: true } } } },
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

  const ownerUserId = action.accountContact.account.ownerUserId ?? action.createdByUserId;
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
