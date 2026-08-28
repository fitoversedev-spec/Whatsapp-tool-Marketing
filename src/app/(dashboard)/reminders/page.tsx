import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfDayIST, endOfDayIST } from "@/lib/time";
import RemindersClient from "./RemindersClient";

export default async function RemindersPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const user = await requireUser();
  const now = new Date();

  const dateFilter = searchParams.date;
  let dateWhere: Record<string, unknown> | undefined;
  if (dateFilter) {
    const picked = new Date(dateFilter + "T00:00:00Z");
    if (!isNaN(picked.getTime())) {
      const dayStart = startOfDayIST(picked);
      const dayEnd = endOfDayIST(picked);
      dateWhere = { dueAt: { gte: dayStart, lte: dayEnd } };
    }
  }

  const reminders = await prisma.reminder.findMany({
    where: {
      ownerUserId: user.id,
      ...(dateWhere
        ? dateWhere
        : {
            OR: [
              { completedAt: null },
              { completedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
            ],
          }),
    },
    orderBy: [
      { completedAt: { sort: "asc", nulls: "first" } },
      { dueAt: "asc" },
    ],
    include: {
      conversation: {
        select: { id: true, contactPhone: true, contactName: true },
      },
      metaLead: { select: { id: true, fullName: true } },
      deal: { select: { id: true, title: true } },
      accountContact: { select: { id: true, name: true } },
    },
    take: 200,
  });

  const endOfToday = endOfDayIST(now);
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  function shape(r: (typeof reminders)[number]) {
    let section: string = "General";
    let sectionLink: string | null = null;
    if (r.metaLeadId) {
      section = "Meta Leads";
      sectionLink = `/ad-campaigns/leads/${r.metaLeadId}`;
    } else if (r.dealId) {
      section = "CRM Deals";
      sectionLink = `/crm/deals/${r.dealId}`;
    } else if (r.accountContactId) {
      section = "CRM Contacts";
      sectionLink = `/crm/contacts/${r.accountContactId}`;
    } else if (r.conversationId) {
      section = "WhatsApp Inbox";
      sectionLink = `/inbox?conversation=${r.conversationId}`;
    }

    let timeBucket: "overdue" | "today" | "week" | "later" | "completed" = "later";
    if (r.completedAt) {
      timeBucket = "completed";
    } else if (r.dueAt < now) {
      timeBucket = "overdue";
    } else if (r.dueAt <= endOfToday) {
      timeBucket = "today";
    } else if (r.dueAt <= weekFromNow) {
      timeBucket = "week";
    }

    return {
      id: r.id,
      conversationId: r.conversationId,
      contactPhone: r.conversation?.contactPhone ?? null,
      contactName: r.conversation?.contactName ?? null,
      message: r.message,
      dueAt: r.dueAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      section,
      sectionLink,
      sectionEntityName:
        r.metaLead?.fullName ??
        r.deal?.title ??
        r.accountContact?.name ??
        r.conversation?.contactName ??
        null,
      timeBucket,
    };
  }

  return (
    <RemindersClient
      reminders={reminders.map(shape)}
      dateFilter={dateFilter ?? null}
    />
  );
}
