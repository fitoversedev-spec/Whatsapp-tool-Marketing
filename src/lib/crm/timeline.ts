// Read-only merge of Activity (past touchpoints/notes) + Reminder (future
// tasks) into one chronological feed. Per the locked decision on this: the
// two underlying tables are NOT merged — this only combines them for
// display, so the live WhatsApp reminder-cron system (src/lib/cron-runner.ts)
// is never touched.
import { prisma } from "@/lib/prisma";
import type { TimelineEntry, TimelineFilter } from "./timelineShared";
import { canSeeContactEvent, excerpt, htmlToText, insightVisibility } from "./contactEvents";

export type { TimelineEntry, TimelineFilter } from "./timelineShared";

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
        select: { name: true, createdAt: true, deletedAt: true, account: { select: { owner: { select: { name: true } } } } },
      });
      return contact && !contact.deletedAt ? { id: `created-${filter.accountContactId}`, kind: "created" as const, title: `Contact created — ${contact.name}`, detail: null, timestamp: contact.createdAt.toISOString(), ownerName: contact.account.owner?.name ?? "—" } : null;
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
      include: { owner: { select: { name: true } }, activityType: { select: { name: true } } },
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
      typeName: a.activityType.name,
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
      typeName: r.activityType?.name ?? null,
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

const EVENT_LABELS: Record<string, string> = {
  details_edited: "EDITED",
  stage_changed: "STAGE",
  rep_changed: "REP",
  lead_added: "LEADS",
  lead_removed: "LEADS",
  note_edited: "NOTE",
  note_deleted: "DELETED",
  next_action_edited: "NEXT ACTION",
  next_action_done: "NEXT ACTION",
  next_action_reopened: "NEXT ACTION",
  next_action_deleted: "DELETED",
  insight_edited: "INSIGHT",
  insight_deleted: "DELETED",
  file_deleted: "DELETED",
  quotation_deleted: "DELETED",
  design_deleted: "DELETED",
};

// Formatted on the server, so pin it to IST rather than the server's UTC.
function fmtIst(d: Date): string {
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtInr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// Everything that's happened with one contact, newest first — the contact
// page's Timeline tab. Rebuilt from each record's own table, so things that
// predate the history log still show at their real dates, plus ContactEvent
// for what those tables can't tell: edits (old → new), deletions, stage / rep /
// Leads moves, next-action and insight activity. Quotations/designs/product
// interest are found the same way the contact page lists them (this contact's
// deals, or a quotation's phone). WhatsApp messages stay out on purpose — far
// too many to be useful here.
export async function getContactTimeline(
  contactId: string,
  viewer: { id: string; role: string },
  limit = 300,
): Promise<TimelineEntry[]> {
  const contact = await prisma.accountContact.findUnique({
    where: { id: contactId },
    select: { name: true, phone: true, createdAt: true, promotedToLeadAt: true, createdByUser: { select: { name: true } } },
  });
  if (!contact) return [];

  const deals = await prisma.deal.findMany({
    where: { primaryContactId: contactId },
    select: { id: true, code: true, title: true, createdAt: true, deletedAt: true, owner: { select: { name: true } } },
  });
  const allDealIds = deals.map((d) => d.id);
  const liveDealIds = deals.filter((d) => !d.deletedAt).map((d) => d.id);
  const quoteOr: object[] = [];
  if (liveDealIds.length) quoteOr.push({ dealId: { in: liveDealIds } });
  if (contact.phone) quoteOr.push({ contactPhone: contact.phone });

  const [activities, reminders, stageHistory, notes, files, quotes, designs, products, nextActions, insights, events] = await Promise.all([
    prisma.activity.findMany({
      where: { accountContactId: contactId },
      orderBy: { occurredAt: "desc" },
      take: limit,
      include: { activityType: { select: { name: true } }, owner: { select: { name: true } } },
    }),
    // Anchored to the contact directly or to one of its deals. Next-action
    // alerts are left out — the next action itself is already on the Timeline.
    prisma.reminder.findMany({
      where: {
        OR: [{ accountContactId: contactId }, ...(liveDealIds.length ? [{ dealId: { in: liveDealIds } }] : [])],
        nextAction: { is: null },
      },
      orderBy: { dueAt: "desc" },
      take: limit,
      include: { owner: { select: { name: true } }, activityType: { select: { name: true } } },
    }),
    allDealIds.length
      ? prisma.dealStageHistory.findMany({
          where: { dealId: { in: allDealIds } },
          orderBy: { changedAt: "desc" },
          take: limit,
          include: { fromStage: { select: { name: true } }, toStage: { select: { name: true } }, changedBy: { select: { name: true } } },
        })
      : Promise.resolve([]),
    prisma.accountContactNote.findMany({
      where: { accountContactId: contactId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { author: { select: { name: true } } },
    }),
    prisma.accountContactAttachment.findMany({
      where: { accountContactId: contactId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { uploadedBy: { select: { name: true } } },
    }),
    quoteOr.length
      ? prisma.quotation.findMany({
          where: quoteOr.length === 1 ? quoteOr[0] : { OR: quoteOr },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: { id: true, number: true, sport: true, grandTotal: true, createdAt: true, sentAt: true, createdBy: { select: { name: true } } },
        })
      : Promise.resolve([]),
    liveDealIds.length
      ? prisma.courtImage.findMany({
          where: { dealId: { in: liveDealIds } },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: { id: true, number: true, createdAt: true, sentAt: true, createdBy: { select: { name: true } } },
        })
      : Promise.resolve([]),
    liveDealIds.length
      ? prisma.dealLineItem.findMany({
          where: { dealId: { in: liveDealIds }, isEnquiryOnly: true },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: { id: true, label: true, createdAt: true, product: { select: { name: true } } },
        })
      : Promise.resolve([]),
    prisma.contactNextAction.findMany({
      where: { accountContactId: contactId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { createdBy: { select: { name: true } } },
    }),
    prisma.contactInsight.findMany({
      where: { accountContactId: contactId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, title: true, body: true, createdAt: true, deletedAt: true, authorUserId: true, author: { select: { name: true } } },
    }),
    prisma.contactEvent.findMany({
      where: { accountContactId: contactId },
      orderBy: { at: "desc" },
      take: limit,
      include: { actor: { select: { name: true } } },
    }),
  ]);

  const createdAsLead =
    !!contact.promotedToLeadAt && Math.abs(contact.promotedToLeadAt.getTime() - contact.createdAt.getTime()) < 2 * 60 * 1000;

  const entries: TimelineEntry[] = [
    {
      id: `created-${contactId}`,
      kind: "created",
      title: `Contact created${createdAsLead ? " as a lead" : ""} — ${contact.name}`,
      detail: null,
      timestamp: contact.createdAt.toISOString(),
      ownerName: contact.createdByUser?.name ?? null,
    },
    ...deals.map((d) => ({
      id: `deal-${d.id}`,
      kind: "deal" as const,
      title: `Deal created — ${d.title}`,
      detail: d.code,
      timestamp: d.createdAt.toISOString(),
      ownerName: d.owner?.name ?? null,
    })),
    ...activities.map((a) => ({
      id: a.id,
      kind: "activity" as const,
      title: `${a.activityType.name} — ${a.subject}`,
      detail: a.notes,
      timestamp: a.occurredAt.toISOString(),
      ownerName: a.owner.name,
      typeName: a.activityType.name,
    })),
    ...reminders.map((r) => ({
      id: r.id,
      kind: "reminder" as const,
      title: r.message,
      detail: r.completedAt && r.completionNote ? r.completionNote : r.notes ?? r.location ?? r.meetingUrl ?? null,
      timestamp: r.dueAt.toISOString(),
      ownerName: r.owner.name,
      completed: !!r.completedAt,
      typeName: r.activityType?.name ?? null,
    })),
    ...stageHistory.map((h) => ({
      id: h.id,
      kind: "stage" as const,
      title: `Deal stage — ${h.fromStage?.name ?? "(start)"} → ${h.toStage.name}`,
      detail: h.note,
      timestamp: h.changedAt.toISOString(),
      ownerName: h.changedBy?.name ?? null,
    })),
    ...notes.map((n) => ({
      id: n.id,
      kind: "note" as const,
      title: `Note added — ${n.title?.trim() || excerpt(n.body)}`,
      // A deleted note keeps its entry (and its own "deleted" entry) but not its text.
      detail: n.deletedAt ? null : n.body,
      timestamp: n.createdAt.toISOString(),
      ownerName: n.author.name,
    })),
    ...files.map((f) => ({
      id: f.id,
      kind: "file" as const,
      title: `File uploaded — ${f.fileName}`,
      detail: null,
      timestamp: f.createdAt.toISOString(),
      ownerName: f.uploadedBy.name,
    })),
    ...quotes.flatMap((q) => [
      {
        id: `quote-${q.id}`,
        kind: "quote" as const,
        title: `Quotation created — ${q.number}`,
        detail: `${q.sport} · ${fmtInr(Number(q.grandTotal))}`,
        timestamp: q.createdAt.toISOString(),
        ownerName: q.createdBy.name,
      },
      ...(q.sentAt
        ? [{ id: `quote-sent-${q.id}`, kind: "quote" as const, title: `Quotation sent — ${q.number}`, detail: null, timestamp: q.sentAt.toISOString(), ownerName: null }]
        : []),
    ]),
    ...designs.flatMap((c) => [
      {
        id: `design-${c.id}`,
        kind: "design" as const,
        title: `Court design created — ${c.number}`,
        detail: null,
        timestamp: c.createdAt.toISOString(),
        ownerName: c.createdBy.name,
      },
      ...(c.sentAt
        ? [{ id: `design-sent-${c.id}`, kind: "design" as const, title: `Court design sent — ${c.number}`, detail: null, timestamp: c.sentAt.toISOString(), ownerName: null }]
        : []),
    ]),
    ...products.map((p) => ({
      id: p.id,
      kind: "product" as const,
      title: `Product interest — ${p.product?.name ?? p.label ?? "Unnamed product"}`,
      detail: null,
      timestamp: p.createdAt.toISOString(),
      ownerName: null,
    })),
    ...nextActions.map((a) => ({
      id: a.id,
      kind: "next_action" as const,
      title: `Next action added — ${excerpt(a.text)}`,
      detail: a.dueAt ? `Due ${fmtIst(a.dueAt)}` : null,
      timestamp: a.createdAt.toISOString(),
      ownerName: a.createdBy.name,
    })),
    // Private: only the author and admins/managers see a rep's insights here.
    ...insights
      .filter((i) => canSeeContactEvent(insightVisibility(i.authorUserId), viewer))
      .map((i) => ({
        id: i.id,
        kind: "insight" as const,
        title: `Insight added — ${i.title?.trim() || excerpt(htmlToText(i.body)) || "Insight"}`,
        detail: null,
        timestamp: i.createdAt.toISOString(),
        ownerName: i.author.name,
      })),
    ...events
      .filter((e) => canSeeContactEvent(e.visibility, viewer))
      .map((e) => ({
        id: e.id,
        kind: "change" as const,
        title: e.summary,
        detail: e.detail,
        timestamp: e.at.toISOString(),
        ownerName: e.actor?.name ?? null,
        label: EVENT_LABELS[e.kind] ?? "UPDATE",
      })),
  ];

  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return entries.slice(0, limit);
}
