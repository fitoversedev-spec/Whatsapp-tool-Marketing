import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { endOfDayIST } from "@/lib/time";
import RemindersClient from "./RemindersClient";

export default async function RemindersPage() {
  const user = await requireUser();
  const now = new Date();
  // "Today" is the IST calendar day, not the server's local day. On Vercel
  // (UTC) the old setHours approach would surface tomorrow's reminders
  // between 18:30 and 23:59 IST as "today" — wrong by a day.
  const endOfToday = endOfDayIST(now);
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const reminders = await prisma.reminder.findMany({
    where: {
      ownerUserId: user.id,
      OR: [
        { completedAt: null },
        // Show recently-completed (last 7 days) for context
        { completedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
      ],
    },
    orderBy: [
      { completedAt: { sort: "asc", nulls: "first" } },
      { dueAt: "asc" },
    ],
    include: {
      conversation: {
        select: { id: true, contactPhone: true, contactName: true },
      },
    },
    take: 200,
  });

  const overdue = reminders.filter((r) => !r.completedAt && r.dueAt < now);
  const today = reminders.filter(
    (r) => !r.completedAt && r.dueAt >= now && r.dueAt <= endOfToday
  );
  const week = reminders.filter(
    (r) => !r.completedAt && r.dueAt > endOfToday && r.dueAt <= weekFromNow
  );
  const later = reminders.filter(
    (r) => !r.completedAt && r.dueAt > weekFromNow
  );
  const completed = reminders.filter((r) => r.completedAt);

  function shape(r: (typeof reminders)[number]) {
    return {
      id: r.id,
      conversationId: r.conversationId,
      contactPhone: r.conversation?.contactPhone ?? null,
      contactName: r.conversation?.contactName ?? null,
      message: r.message,
      dueAt: r.dueAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  return (
    <RemindersClient
      overdue={overdue.map(shape)}
      today={today.map(shape)}
      week={week.map(shape)}
      later={later.map(shape)}
      completed={completed.map(shape)}
    />
  );
}
