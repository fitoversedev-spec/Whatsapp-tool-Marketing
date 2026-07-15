// Sales team performance analytics. Admin-only. Aggregates per-user
// metrics across conversations, quotations, court designs, messages,
// pipeline movements, and reminders, plus a team-wide rollup and a
// flat "recent activity" feed for the dashboard's right rail.
//
// All counts respect the requested date range via the `range` query
// param (7d / 30d / 90d / all). The range applies to the time the
// action *happened* (quote sent, design sent, message sent, pipeline
// stage changed) — not to when the underlying conversation was first
// created. Pipeline distribution is a current-state snapshot regardless
// of range.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { salesActivity } from "@/lib/analytics/salesActivity";
import { funnelSnapshot } from "@/lib/analytics/funnel";
import { geography } from "@/lib/analytics/geography";
import { customerSegments } from "@/lib/analytics/customers";
import { productAnalytics } from "@/lib/analytics/products";
import { sourceAnalytics } from "@/lib/analytics/sources";
import { timelineMetrics } from "@/lib/analytics/timelines";
import { forecast } from "@/lib/analytics/forecast";
import { overview } from "@/lib/analytics/overview";

export const runtime = "nodejs";
export const maxDuration = 30;

type Range = "7d" | "30d" | "90d" | "all";

function rangeStart(range: Range): Date | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json(
      { error: "forbidden", message: "Admin only" },
      { status: 403 }
    );
  }

  const rangeParam = (req.nextUrl.searchParams.get("range") ?? "30d") as Range;
  const since = rangeStart(rangeParam);
  const sinceFilter = since ? { gte: since } : undefined;

  // 1. All sales-team users (admin + sales). We rank by activity so the
  //    table can default-sort by usefulness.
  const users = await prisma.user.findMany({
    where: {
      role: { in: ["admin", "sales"] },
      isActive: true,
      deletedAt: null,
    },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { name: "asc" },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  // 2. Per-user counts. We issue grouped queries in parallel rather than
  //    looping per-user. Each query produces { user_id, _count: ... }
  //    that we fold into a per-user metrics object.
  const [
    assignedByUser,
    quotesSentByUser,
    quotesDraftByUser,
    quotesValueByUser,
    designsSentByUser,
    designsDraftByUser,
    messagesSentByUser,
    notesByUser,
    remindersDoneByUser,
    remindersOverdueByUser,
    pipelineMovesByUser,
    pipelineDistribution,
  ] = await Promise.all([
    // Active assigned conversations (regardless of range — current load)
    prisma.conversation.groupBy({
      by: ["assignedToUserId"],
      where: {
        assignedToUserId: { not: null },
        status: "open",
      },
      _count: { _all: true },
    }),

    // Sent quotations within range, grouped by creator
    prisma.quotation.groupBy({
      by: ["createdByUserId"],
      where: {
        status: "sent",
        ...(sinceFilter && { sentAt: sinceFilter }),
      },
      _count: { _all: true },
    }),

    // Draft quotations within range
    prisma.quotation.groupBy({
      by: ["createdByUserId"],
      where: {
        status: "draft",
        ...(sinceFilter && { createdAt: sinceFilter }),
      },
      _count: { _all: true },
    }),

    // Sum of grand total for sent quotes in range
    prisma.quotation.groupBy({
      by: ["createdByUserId"],
      where: {
        status: "sent",
        ...(sinceFilter && { sentAt: sinceFilter }),
      },
      _sum: { grandTotal: true },
    }),

    // Sent court designs within range
    prisma.courtImage.groupBy({
      by: ["createdByUserId"],
      where: {
        status: "sent",
        ...(sinceFilter && { sentAt: sinceFilter }),
      },
      _count: { _all: true },
    }),

    // Draft court designs within range
    prisma.courtImage.groupBy({
      by: ["createdByUserId"],
      where: {
        status: "draft",
        ...(sinceFilter && { createdAt: sinceFilter }),
      },
      _count: { _all: true },
    }),

    // Outbound messages sent within range
    prisma.message.groupBy({
      by: ["sentByUserId"],
      where: {
        direction: "outbound",
        sentByUserId: { not: null },
        ...(sinceFilter && { createdAt: sinceFilter }),
      },
      _count: { _all: true },
    }),

    // Notes authored within range
    prisma.conversationNote.groupBy({
      by: ["authorUserId"],
      where: {
        ...(sinceFilter && { createdAt: sinceFilter }),
      },
      _count: { _all: true },
    }),

    // Reminders completed within range
    prisma.reminder.groupBy({
      by: ["ownerUserId"],
      where: {
        completedAt: { not: null },
        ...(sinceFilter && { completedAt: sinceFilter }),
      },
      _count: { _all: true },
    }),

    // Reminders overdue right now (not completed + due in the past)
    prisma.reminder.groupBy({
      by: ["ownerUserId"],
      where: {
        completedAt: null,
        dueAt: { lt: new Date() },
      },
      _count: { _all: true },
    }),

    // Pipeline stage changes within range (activity proxy)
    prisma.pipelineStageHistory.groupBy({
      by: ["changedByUserId"],
      where: {
        ...(sinceFilter && { changedAt: sinceFilter }),
      },
      _count: { _all: true },
    }),

    // Current pipeline distribution: stage -> count for assigned convs
    prisma.conversation.groupBy({
      by: ["assignedToUserId", "pipelineStage"],
      where: {
        assignedToUserId: { not: null },
        status: "open",
      },
      _count: { _all: true },
    }),
  ]);

  // Index helpers
  function toMap<T>(
    rows: T[],
    keyOf: (r: T) => string | null,
    valueOf: (r: T) => number
  ): Map<string, number> {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = keyOf(r);
      if (!k) continue;
      m.set(k, valueOf(r));
    }
    return m;
  }

  const assignedM = toMap(
    assignedByUser,
    (r) => r.assignedToUserId,
    (r) => r._count._all
  );
  const qSentM = toMap(quotesSentByUser, (r) => r.createdByUserId, (r) => r._count._all);
  const qDraftM = toMap(quotesDraftByUser, (r) => r.createdByUserId, (r) => r._count._all);
  const qValueM = toMap(
    quotesValueByUser,
    (r) => r.createdByUserId,
    (r) => Number(r._sum.grandTotal ?? 0)
  );
  const dSentM = toMap(designsSentByUser, (r) => r.createdByUserId, (r) => r._count._all);
  const dDraftM = toMap(designsDraftByUser, (r) => r.createdByUserId, (r) => r._count._all);
  const msgM = toMap(messagesSentByUser, (r) => r.sentByUserId, (r) => r._count._all);
  const notesM = toMap(notesByUser, (r) => r.authorUserId, (r) => r._count._all);
  const remDoneM = toMap(remindersDoneByUser, (r) => r.ownerUserId, (r) => r._count._all);
  const remOverM = toMap(
    remindersOverdueByUser,
    (r) => r.ownerUserId,
    (r) => r._count._all
  );
  const pipeMovesM = toMap(
    pipelineMovesByUser,
    (r) => r.changedByUserId,
    (r) => r._count._all
  );

  // Pipeline distribution: { userId -> { stage -> count } }
  const pipeDistM = new Map<string, Record<string, number>>();
  for (const row of pipelineDistribution) {
    if (!row.assignedToUserId) continue;
    const existing = pipeDistM.get(row.assignedToUserId) ?? {};
    existing[row.pipelineStage ?? "new"] = row._count._all;
    pipeDistM.set(row.assignedToUserId, existing);
  }

  // 3. Build per-user payload
  const perUser = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    assignedConversations: assignedM.get(u.id) ?? 0,
    quotationsSent: qSentM.get(u.id) ?? 0,
    quotationsDraft: qDraftM.get(u.id) ?? 0,
    quotationsValueInr: qValueM.get(u.id) ?? 0,
    courtDesignsSent: dSentM.get(u.id) ?? 0,
    courtDesignsDraft: dDraftM.get(u.id) ?? 0,
    messagesSent: msgM.get(u.id) ?? 0,
    notesWritten: notesM.get(u.id) ?? 0,
    remindersCompleted: remDoneM.get(u.id) ?? 0,
    remindersOverdue: remOverM.get(u.id) ?? 0,
    pipelineMoves: pipeMovesM.get(u.id) ?? 0,
    pipelineDistribution: pipeDistM.get(u.id) ?? {},
  }));

  // 4. Team totals
  const teamTotals = {
    activeReps: users.length,
    assignedConversations: perUser.reduce((s, u) => s + u.assignedConversations, 0),
    quotationsSent: perUser.reduce((s, u) => s + u.quotationsSent, 0),
    quotationsValueInr: perUser.reduce((s, u) => s + u.quotationsValueInr, 0),
    courtDesignsSent: perUser.reduce((s, u) => s + u.courtDesignsSent, 0),
    messagesSent: perUser.reduce((s, u) => s + u.messagesSent, 0),
    remindersOverdue: perUser.reduce((s, u) => s + u.remindersOverdue, 0),
  };

  // 5. Recent activity feed — union of recent events from each source,
  //    sorted desc. Limit each source so a chatty source doesn't drown
  //    out the others.
  const ACTIVITY_LIMIT_PER_SOURCE = 8;
  const [recentQuotes, recentDesigns, recentNotes, recentPipeMoves] =
    await Promise.all([
      prisma.quotation.findMany({
        where: { sentAt: { not: null }, ...(sinceFilter && { sentAt: sinceFilter }) },
        orderBy: { sentAt: "desc" },
        take: ACTIVITY_LIMIT_PER_SOURCE,
        select: {
          id: true,
          number: true,
          customerName: true,
          createdByUserId: true,
          grandTotal: true,
          sentAt: true,
        },
      }),
      prisma.courtImage.findMany({
        where: { sentAt: { not: null }, ...(sinceFilter && { sentAt: sinceFilter }) },
        orderBy: { sentAt: "desc" },
        take: ACTIVITY_LIMIT_PER_SOURCE,
        select: {
          id: true,
          number: true,
          customerName: true,
          createdByUserId: true,
          sentAt: true,
        },
      }),
      prisma.conversationNote.findMany({
        where: { ...(sinceFilter && { createdAt: sinceFilter }) },
        orderBy: { createdAt: "desc" },
        take: ACTIVITY_LIMIT_PER_SOURCE,
        select: {
          id: true,
          authorUserId: true,
          body: true,
          createdAt: true,
          conversation: {
            select: { id: true, contactName: true, contactPhone: true },
          },
        },
      }),
      prisma.pipelineStageHistory.findMany({
        where: { ...(sinceFilter && { changedAt: sinceFilter }) },
        orderBy: { changedAt: "desc" },
        take: ACTIVITY_LIMIT_PER_SOURCE,
        select: {
          id: true,
          changedByUserId: true,
          fromStage: true,
          toStage: true,
          changedAt: true,
          conversation: {
            select: { id: true, contactName: true, contactPhone: true },
          },
        },
      }),
    ]);

  type Activity = {
    id: string;
    type: "quote" | "design" | "note" | "pipeline";
    when: string;
    userId: string | null;
    userName: string | null;
    summary: string;
    href?: string;
  };
  const activity: Activity[] = [];
  for (const q of recentQuotes) {
    activity.push({
      id: `q-${q.id}`,
      type: "quote",
      when: q.sentAt!.toISOString(),
      userId: q.createdByUserId,
      userName: userMap.get(q.createdByUserId)?.name ?? null,
      summary: `sent quote ${q.number} to ${q.customerName} for Rs.${Number(q.grandTotal).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      href: `/quotations`,
    });
  }
  for (const d of recentDesigns) {
    activity.push({
      id: `d-${d.id}`,
      type: "design",
      when: d.sentAt!.toISOString(),
      userId: d.createdByUserId,
      userName: userMap.get(d.createdByUserId)?.name ?? null,
      summary: `sent court design ${d.number} to ${d.customerName}`,
      href: `/court-images`,
    });
  }
  for (const n of recentNotes) {
    activity.push({
      id: `n-${n.id}`,
      type: "note",
      when: n.createdAt.toISOString(),
      userId: n.authorUserId,
      userName: userMap.get(n.authorUserId)?.name ?? null,
      summary: `added note to ${n.conversation?.contactName ?? n.conversation?.contactPhone ?? "a conversation"}`,
      href: `/inbox`,
    });
  }
  for (const p of recentPipeMoves) {
    activity.push({
      id: `p-${p.id}`,
      type: "pipeline",
      when: p.changedAt.toISOString(),
      userId: p.changedByUserId,
      userName: userMap.get(p.changedByUserId)?.name ?? null,
      summary: `moved ${p.conversation?.contactName ?? p.conversation?.contactPhone ?? "a contact"} ${
        p.fromStage ? `from ${p.fromStage} ` : ""
      }to ${p.toStage}`,
      href: `/pipeline`,
    });
  }
  activity.sort((a, b) => b.when.localeCompare(a.when));

  // Phase 4 — the 9-screen analytics build, nested here rather than a new
  // top-level route (see docs/DECISIONS.md — avoids colliding with the
  // pre-existing, unrelated /analytics WhatsApp-broadcast-analytics page).
  // sales-activity + funnel + geography + customers ship first; 5 more follow.
  const analyticsFrom = since ?? new Date(0);
  const analyticsTo = new Date();
  const [salesActivityRows, funnel, geo, customers, products, sources, timelines, forecastResult, overviewResult] = await Promise.all([
    salesActivity({ from: analyticsFrom, to: analyticsTo }),
    funnelSnapshot({ from: analyticsFrom, to: analyticsTo }),
    geography({ from: analyticsFrom, to: analyticsTo }),
    customerSegments({ from: analyticsFrom, to: analyticsTo }),
    productAnalytics({ from: analyticsFrom, to: analyticsTo }),
    sourceAnalytics({ from: analyticsFrom, to: analyticsTo }),
    timelineMetrics({ from: analyticsFrom, to: analyticsTo }),
    // Forecast looks forward from "now" (expectedCloseAt), not the range's
    // own start — the range picker still scopes it via ownerIds, but a
    // 7d/30d "since" window would wrongly exclude deals expected to close
    // further out than the activity range being reviewed.
    forecast({ from: new Date(), to: new Date(Date.now() + 365 * 86_400_000) }),
    // Overview is always this-month-vs-last, independent of the range picker.
    overview(),
  ]);

  return NextResponse.json({
    range: rangeParam,
    since: since?.toISOString() ?? null,
    teamTotals,
    perUser,
    activity: activity.slice(0, 25),
    salesActivity: salesActivityRows,
    funnel,
    geography: geo,
    customers,
    products,
    sources,
    timelines,
    forecast: forecastResult,
    overview: { ...overviewResult, stuckDealCount: timelines.stuckDeals.length },
  });
}
