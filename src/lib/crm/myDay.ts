// Shared "My Day" data — extracted from the WhatsApp bot's `my_day`
// command (src/lib/chatbot/staffCommands.ts), which now calls this instead
// of computing it inline, so the same logic backs both the bot reply and
// the new web dashboard (Phase 4). Adds the one piece the bot command
// never had: deals closing within 7 days (spec §7.5's fourth bucket).
import { prisma } from "@/lib/prisma";
import { startOfDayIST, endOfDayIST } from "@/lib/time";

const DEFAULT_SLA_HOURS = 72;

export type MyDayReminder = { id: string; message: string; dueAt: string };
export type MyDayDeal = { id: string; code: string; title: string };
export type MyDayClosingDeal = MyDayDeal & { expectedCloseAt: string };

export type MyDayData = {
  dueToday: MyDayReminder[];
  overdue: MyDayReminder[];
  stuckDeals: MyDayDeal[];
  noRecentActivityDeals: MyDayDeal[];
  closingThisWeek: MyDayClosingDeal[];
};

export async function getMyDay(userId: string): Promise<MyDayData> {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const sevenDaysAhead = new Date(now.getTime() + 7 * 86_400_000);

  const [reminders, openDeals, closing] = await Promise.all([
    prisma.reminder.findMany({
      where: { ownerUserId: userId, completedAt: null, dueAt: { lte: endOfToday } },
      orderBy: { dueAt: "asc" },
      select: { id: true, message: true, dueAt: true },
    }),
    prisma.deal.findMany({
      where: { deletedAt: null, outcome: null, ownerUserId: userId },
      select: {
        id: true,
        code: true,
        title: true,
        enquiryAt: true,
        currentStage: { select: { slaHours: true } },
        stageHistory: { orderBy: { changedAt: "desc" }, take: 1, select: { changedAt: true } },
        activities: { orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true } },
      },
    }),
    prisma.deal.findMany({
      where: {
        deletedAt: null,
        outcome: null,
        ownerUserId: userId,
        expectedCloseAt: { gte: now, lte: sevenDaysAhead },
      },
      orderBy: { expectedCloseAt: "asc" },
      select: { id: true, code: true, title: true, expectedCloseAt: true },
    }),
  ]);

  const overdue = reminders.filter((r) => r.dueAt < startOfToday);
  const dueToday = reminders.filter((r) => r.dueAt >= startOfToday);

  const stuckDeals = openDeals.filter((d) => {
    const lastChange = d.stageHistory[0]?.changedAt ?? d.enquiryAt;
    const slaHours = d.currentStage.slaHours ?? DEFAULT_SLA_HOURS;
    return (now.getTime() - lastChange.getTime()) / 3_600_000 > slaHours;
  });
  const noRecentActivityDeals = openDeals.filter((d) => {
    const last = d.activities[0]?.occurredAt;
    return !last || last < sevenDaysAgo;
  });

  return {
    dueToday: dueToday.map((r) => ({ id: r.id, message: r.message, dueAt: r.dueAt.toISOString() })),
    overdue: overdue.map((r) => ({ id: r.id, message: r.message, dueAt: r.dueAt.toISOString() })),
    stuckDeals: stuckDeals.map((d) => ({ id: d.id, code: d.code, title: d.title })),
    noRecentActivityDeals: noRecentActivityDeals.map((d) => ({ id: d.id, code: d.code, title: d.title })),
    closingThisWeek: closing.map((d) => ({ id: d.id, code: d.code, title: d.title, expectedCloseAt: d.expectedCloseAt!.toISOString() })),
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
    else if (r.dealId) contactLink = `/crm/deals/${r.dealId}`;
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
