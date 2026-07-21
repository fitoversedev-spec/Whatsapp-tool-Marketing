// Read-only merge of Activity (past touchpoints/notes) + Reminder (future
// tasks) into one chronological feed. Per the locked decision on this: the
// two underlying tables are NOT merged — this only combines them for
// display, so the live WhatsApp reminder-cron system (src/lib/cron-runner.ts)
// is never touched.
import { prisma } from "@/lib/prisma";

export type TimelineEntry = {
  id: string;
  kind: "activity" | "reminder" | "created" | "stage";
  title: string;
  detail: string | null;
  timestamp: string; // Activity.occurredAt, Reminder.dueAt, DealStageHistory.changedAt, or the record's own createdAt
  ownerName: string;
  completed?: boolean; // reminders only
};

export type TimelineFilter = {
  dealId?: string;
  accountId?: string;
  leadId?: string;
  accountContactId?: string;
};

export async function getUnifiedTimeline(filter: TimelineFilter, limit = 50): Promise<TimelineEntry[]> {
  const activityWhere: Record<string, string> = {};
  if (filter.dealId) activityWhere.dealId = filter.dealId;
  if (filter.accountId) activityWhere.accountId = filter.accountId;
  if (filter.leadId) activityWhere.leadId = filter.leadId;
  if (filter.accountContactId) activityWhere.accountContactId = filter.accountContactId;

  // Reminder only carries dealId directly (no account/lead/contact FK) —
  // scope those filters through the deals they belong to instead. It CAN
  // reach a contact this way, through the deal's primaryContactId (same
  // path stageHistoryWhere below uses) — a bare accountContactId filter
  // used to fall through to "nothing to fetch", which silently hid every
  // scheduled meeting/call from a contact's own timeline.
  const reminderWhere: Record<string, unknown> = {};
  if (filter.dealId) {
    reminderWhere.dealId = filter.dealId;
  } else if (filter.accountId) {
    reminderWhere.deal = { accountId: filter.accountId };
  } else if (filter.accountContactId) {
    reminderWhere.deal = { primaryContactId: filter.accountContactId };
  } else {
    reminderWhere.id = "__none__";
  }

  // DealStageHistory has no account/lead/contact FK either, but unlike
  // Reminder it CAN reach a contact — through the deal's primaryContactId —
  // so a bare accountContactId filter gets real stage-change entries where
  // Reminder gets none.
  const stageHistoryWhere: Record<string, unknown> = {};
  if (filter.dealId) {
    stageHistoryWhere.dealId = filter.dealId;
  } else if (filter.accountId) {
    stageHistoryWhere.deal = { accountId: filter.accountId };
  } else if (filter.accountContactId) {
    stageHistoryWhere.deal = { primaryContactId: filter.accountContactId };
  } else {
    stageHistoryWhere.id = "__none__";
  }

  // A synthetic "created" entry for the record itself — matches the
  // reference pattern (Zoho's History tab shows "Contact Created" as a
  // first-class timeline event, not just a field on the record). None of
  // these 4 models track a distinct creator separate from their owner, so
  // the owner is used as the closest available attribution rather than
  // inventing one.
  const createdEntryPromise: Promise<TimelineEntry | null> = (async () => {
    if (filter.dealId) {
      const deal = await prisma.deal.findUnique({
        where: { id: filter.dealId },
        select: { title: true, createdAt: true, owner: { select: { name: true } } },
      });
      return deal ? { id: `created-${filter.dealId}`, kind: "created" as const, title: `Deal created — ${deal.title}`, detail: null, timestamp: deal.createdAt.toISOString(), ownerName: deal.owner?.name ?? "—" } : null;
    }
    if (filter.accountContactId) {
      const contact = await prisma.accountContact.findUnique({
        where: { id: filter.accountContactId },
        select: { name: true, createdAt: true, account: { select: { owner: { select: { name: true } } } } },
      });
      return contact ? { id: `created-${filter.accountContactId}`, kind: "created" as const, title: `Contact created — ${contact.name}`, detail: null, timestamp: contact.createdAt.toISOString(), ownerName: contact.account.owner?.name ?? "—" } : null;
    }
    if (filter.accountId) {
      const account = await prisma.account.findUnique({
        where: { id: filter.accountId },
        select: { name: true, createdAt: true, owner: { select: { name: true } } },
      });
      return account ? { id: `created-${filter.accountId}`, kind: "created" as const, title: `Company created — ${account.name}`, detail: null, timestamp: account.createdAt.toISOString(), ownerName: account.owner?.name ?? "—" } : null;
    }
    return null;
  })();

  const [activities, reminders, stageHistory, createdEntry] = await Promise.all([
    Object.keys(activityWhere).length
      ? prisma.activity.findMany({
          where: activityWhere,
          orderBy: { occurredAt: "desc" },
          take: limit,
          include: { activityType: { select: { name: true } }, owner: { select: { name: true } } },
        })
      : Promise.resolve([]),
    prisma.reminder.findMany({
      where: reminderWhere,
      orderBy: { dueAt: "desc" },
      take: limit,
      include: { owner: { select: { name: true } } },
    }),
    prisma.dealStageHistory.findMany({
      where: stageHistoryWhere,
      orderBy: { changedAt: "desc" },
      take: limit,
      include: {
        fromStage: { select: { name: true } },
        toStage: { select: { name: true } },
        changedBy: { select: { name: true } },
      },
    }),
    createdEntryPromise,
  ]);

  const entries: TimelineEntry[] = [
    ...activities.map((a) => ({
      id: a.id,
      kind: "activity" as const,
      title: `${a.activityType.name} — ${a.subject}`,
      detail: a.notes,
      timestamp: a.occurredAt.toISOString(),
      ownerName: a.owner.name,
    })),
    ...reminders.map((r) => ({
      id: r.id,
      kind: "reminder" as const,
      // Once completed, what actually happened (the completion note) is
      // more useful than the original scheduling detail.
      title: r.message,
      detail: r.completedAt && r.completionNote ? r.completionNote : r.location ?? r.meetingUrl ?? null,
      timestamp: r.dueAt.toISOString(),
      ownerName: r.owner.name,
      completed: !!r.completedAt,
    })),
    ...stageHistory.map((h) => ({
      id: h.id,
      kind: "stage" as const,
      title: `Stage changed — ${h.fromStage?.name ?? "(start)"} → ${h.toStage.name}`,
      detail: h.note,
      timestamp: h.changedAt.toISOString(),
      ownerName: h.changedBy?.name ?? "System",
    })),
    ...(createdEntry ? [createdEntry] : []),
  ];

  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return entries.slice(0, limit);
}
