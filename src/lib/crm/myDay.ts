// Shared "My Day" data — backs both the staff WhatsApp bot's `my_day`
// command (src/lib/chatbot/staffCommands.ts) and the web dashboard.
// Deals are confirmed projects only, so the follow-up buckets are about
// LEADS: leads nobody has touched in 7+ days, and next actions coming up
// this week (today's and overdue ones already show as reminders).
import { prisma } from "@/lib/prisma";
import { startOfDayIST, endOfDayIST } from "@/lib/time";

export type MyDayReminder = { id: string; message: string; dueAt: string };
export type MyDayLead = { id: string; name: string; company: string | null; lastTouchAt: string };
export type MyDayNextAction = { id: string; text: string; dueAt: string; contactId: string; contactName: string };

export type MyDayData = {
  dueToday: MyDayReminder[];
  overdue: MyDayReminder[];
  untouchedLeads: MyDayLead[];
  nextActionsThisWeek: MyDayNextAction[];
  // How many there are in all (the list stops at 20).
  nextActionsThisWeekTotal: number;
};

export async function getMyDay(userId: string): Promise<MyDayData> {
  const now = new Date();
  const startOfToday = startOfDayIST(now);
  const endOfToday = endOfDayIST(now);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const endOfWeek = endOfDayIST(new Date(now.getTime() + 7 * 86_400_000));

  // Open, dated next actions after today on the rep's customers (or ones
  // they set themselves on a customer nobody handles yet).
  const nextActionsWhere = {
    deletedAt: null,
    doneAt: null,
    dueAt: { gt: endOfToday, lte: endOfWeek },
    accountContact: { deletedAt: null },
    OR: [
      { accountContact: { account: { ownerUserId: userId } } },
      { createdByUserId: userId, accountContact: { account: { ownerUserId: null } } },
    ],
  };
  const [reminders, leads, nextActions, nextActionsThisWeekTotal] = await Promise.all([
    prisma.reminder.findMany({
      where: { ownerUserId: userId, completedAt: null, dueAt: { lte: endOfToday } },
      orderBy: { dueAt: "asc" },
      select: { id: true, message: true, dueAt: true },
    }),
    prisma.accountContact.findMany({
      where: { deletedAt: null, pipelineStage: "LEAD", account: { ownerUserId: userId } },
      select: { id: true, name: true, createdAt: true, promotedToLeadAt: true, account: { select: { name: true } } },
    }),
    prisma.contactNextAction.findMany({
      where: nextActionsWhere,
      orderBy: { dueAt: "asc" },
      take: 20,
      select: { id: true, text: true, dueAt: true, accountContact: { select: { id: true, name: true } } },
    }),
    prisma.contactNextAction.count({ where: nextActionsWhere }),
  ]);

  // A lead's last touch: its newest timeline event, activity or note —
  // else when it became a lead.
  const ids = leads.map((l) => l.id);
  const [events, activities, notes] = ids.length
    ? await Promise.all([
        prisma.contactEvent.groupBy({ by: ["accountContactId"], where: { accountContactId: { in: ids } }, _max: { at: true } }),
        prisma.activity.groupBy({ by: ["accountContactId"], where: { accountContactId: { in: ids } }, _max: { occurredAt: true } }),
        prisma.accountContactNote.groupBy({ by: ["accountContactId"], where: { accountContactId: { in: ids } }, _max: { createdAt: true } }),
      ])
    : [[], [], []];
  const lastTouch = new Map<string, number>();
  const bump = (id: string | null, at: Date | null | undefined) => {
    if (!id || !at) return;
    if (at.getTime() > (lastTouch.get(id) ?? 0)) lastTouch.set(id, at.getTime());
  };
  for (const l of leads) bump(l.id, l.promotedToLeadAt ?? l.createdAt);
  for (const g of events) bump(g.accountContactId, g._max.at);
  for (const g of activities) bump(g.accountContactId, g._max.occurredAt);
  for (const g of notes) bump(g.accountContactId, g._max.createdAt);

  const untouchedLeads = leads
    .map((l) => ({ l, at: lastTouch.get(l.id) ?? l.createdAt.getTime() }))
    .filter((x) => x.at < sevenDaysAgo.getTime())
    .sort((a, b) => a.at - b.at)
    .map(({ l, at }) => ({
      id: l.id,
      name: l.name.trim(),
      company: l.account.name.trim() !== l.name.trim() ? l.account.name.trim() : null,
      lastTouchAt: new Date(at).toISOString(),
    }));

  const overdue = reminders.filter((r) => r.dueAt < startOfToday);
  const dueToday = reminders.filter((r) => r.dueAt >= startOfToday);

  return {
    dueToday: dueToday.map((r) => ({ id: r.id, message: r.message, dueAt: r.dueAt.toISOString() })),
    overdue: overdue.map((r) => ({ id: r.id, message: r.message, dueAt: r.dueAt.toISOString() })),
    untouchedLeads,
    nextActionsThisWeek: nextActions.map((a) => ({
      id: a.id,
      text: a.text,
      dueAt: a.dueAt!.toISOString(),
      contactId: a.accountContact.id,
      contactName: a.accountContact.name.trim(),
    })),
    nextActionsThisWeekTotal,
  };
}

// ---- Upcoming schedule (scheduled meetings / calls / tasks) ----------------

export type UpcomingReminder = {
  id: string;
  message: string;
  dueAt: string;
  typeName: string | null;
  priority: string | null;
  ownerName: string;
  contactName: string | null;
  contactLink: string | null;
};

export type UpcomingScheduleData = {
  overdue: UpcomingReminder[];
  today: UpcomingReminder[];
  tomorrow: UpcomingReminder[];
  week: UpcomingReminder[];
  total: number;
};

// Scheduled meetings/calls/tasks (Reminder rows tagged with an ActivityType —
// plain follow-up reminders leave activityTypeId null and are excluded, mirroring
// how ContactDetailClient/activities distinguish the two) that are OVERDUE or
// fall within today..+7 days. Pass ownerUserId to scope to one rep; omit it for
// the team-wide (admin) view. Day boundaries use the IST helpers so
// "today"/"tomorrow" track the team's calendar rather than the server's UTC one.
export async function getUpcomingSchedule(opts: { ownerUserId?: string } = {}): Promise<UpcomingScheduleData> {
  const now = new Date();
  const startToday = startOfDayIST(now);
  const endToday = endOfDayIST(now);
  const endTomorrow = endOfDayIST(new Date(now.getTime() + 86_400_000));
  const endWeek = endOfDayIST(new Date(now.getTime() + 7 * 86_400_000));

  const reminders = await prisma.reminder.findMany({
    where: {
      ...(opts.ownerUserId ? { ownerUserId: opts.ownerUserId } : {}),
      completedAt: null,
      activityTypeId: { not: null },
      dueAt: { lte: endWeek },
    },
    orderBy: { dueAt: "asc" },
    select: {
      id: true,
      message: true,
      dueAt: true,
      priority: true,
      accountContactId: true,
      dealId: true,
      metaLeadId: true,
      conversationId: true,
      activityType: { select: { name: true } },
      owner: { select: { name: true } },
      accountContact: { select: { id: true, name: true } },
      conversation: { select: { id: true, contactName: true } },
      metaLead: { select: { id: true, fullName: true } },
      deal: { select: { id: true, title: true } },
    },
  });

  const overdue: UpcomingReminder[] = [];
  const today: UpcomingReminder[] = [];
  const tomorrow: UpcomingReminder[] = [];
  const week: UpcomingReminder[] = [];

  for (const r of reminders) {
    const contactName = r.accountContact?.name ?? r.conversation?.contactName ?? r.metaLead?.fullName ?? null;
    let contactLink: string | null = null;
    if (r.accountContactId) contactLink = `/crm/contacts/${r.accountContactId}`;
    else if (r.dealId) contactLink = `/deals/${r.dealId}`;
    else if (r.metaLeadId) contactLink = `/ad-campaigns/leads/${r.metaLeadId}`;
    else if (r.conversationId) contactLink = `/inbox?conversation=${r.conversationId}`;

    const row: UpcomingReminder = {
      id: r.id,
      message: r.message,
      dueAt: r.dueAt.toISOString(),
      typeName: r.activityType?.name ?? null,
      priority: r.priority,
      ownerName: r.owner.name,
      contactName: contactName ?? r.deal?.title ?? null,
      contactLink,
    };
    if (r.dueAt < startToday) overdue.push(row);
    else if (r.dueAt <= endToday) today.push(row);
    else if (r.dueAt <= endTomorrow) tomorrow.push(row);
    else week.push(row);
  }

  return { overdue, today, tomorrow, week, total: reminders.length };
}
