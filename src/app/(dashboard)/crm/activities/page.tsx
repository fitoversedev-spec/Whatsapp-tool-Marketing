import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import ActivitiesClient, { type ActivityRow } from "./ActivitiesClient";

export default async function ActivitiesPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const user = await requireUser();
  const dateRange = searchParams.from && searchParams.to ? { from: searchParams.from, to: searchParams.to } : null;
  const gte = dateRange ? new Date(dateRange.from + "T00:00:00") : null;
  const lte = dateRange ? new Date(dateRange.to + "T23:59:59") : null;
  const ownerScope = isAdmin(user.role) ? {} : { ownerUserId: user.id };

  // Logged activities (past touchpoints) and scheduled/completed reminders
  // (meetings/calls/tasks) are two different tables — query both under the
  // same owner scope + date window, then merge into one time-ordered feed.
  // Activities window on occurredAt; reminders on dueAt.
  const [activities, reminders] = await Promise.all([
    prisma.activity.findMany({
      where: {
        ...ownerScope,
        ...(gte && lte ? { occurredAt: { gte, lte } } : {}),
      },
      orderBy: { occurredAt: "desc" },
      take: 200,
      include: {
        activityType: { select: { name: true } },
        owner: { select: { id: true, name: true } },
        deal: { select: { id: true, code: true, title: true } },
        account: { select: { id: true, name: true } },
        accountContact: { select: { name: true, phone: true } },
      },
    }),
    prisma.reminder.findMany({
      where: {
        ...ownerScope,
        ...(gte && lte ? { dueAt: { gte, lte } } : {}),
      },
      orderBy: { dueAt: "desc" },
      take: 200,
      include: {
        activityType: { select: { name: true } },
        owner: { select: { id: true, name: true } },
        // deal.primaryContact is the fallback source for name/phone when the
        // reminder itself isn't anchored to a contact.
        deal: { select: { id: true, code: true, title: true, primaryContact: { select: { name: true, phone: true } } } },
        accountContact: { select: { name: true, phone: true } },
      },
    }),
  ]);

  const activityRows: ActivityRow[] = activities.map((a) => ({
    id: `activity:${a.id}`,
    kind: "logged",
    typeName: a.activityType.name,
    title: a.subject,
    detail: a.notes,
    timestamp: a.occurredAt.toISOString(),
    durationMins: a.durationMins,
    outcome: a.outcome,
    ownerName: a.owner.name,
    dealId: a.deal?.id ?? null,
    dealCode: a.deal?.code ?? null,
    accountId: a.account?.id ?? null,
    accountName: a.account?.name ?? null,
    contactName: a.accountContact?.name ?? a.account?.name ?? null,
    contactPhone: a.accountContact?.phone ?? null,
  }));

  const reminderRows: ActivityRow[] = reminders.map((r) => ({
    id: `reminder:${r.id}`,
    kind: r.completedAt ? "done" : "scheduled",
    typeName: r.activityType?.name ?? null,
    title: r.message,
    detail: r.completionNote ?? null,
    timestamp: r.dueAt.toISOString(),
    durationMins: null,
    outcome: null,
    ownerName: r.owner.name,
    dealId: r.deal?.id ?? null,
    dealCode: r.deal?.code ?? null,
    accountId: null,
    accountName: null,
    contactName: r.accountContact?.name ?? r.deal?.primaryContact?.name ?? null,
    contactPhone: r.accountContact?.phone ?? r.deal?.primaryContact?.phone ?? null,
  }));

  const merged = [...activityRows, ...reminderRows]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 200);

  return <ActivitiesClient isAdmin={isAdmin(user.role)} activities={merged} dateRange={dateRange} />;
}
