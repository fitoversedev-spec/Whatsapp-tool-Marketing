/**
 * The human side of the AI → human handoff: list the requests, approve one by
 * assigning a salesperson, reject it (the AI carries on), or hand an assigned
 * chat back to the AI.
 *
 * Who may do what:
 *   approve / reject   an AI approver (Setting agent_approvers; admins by default)
 *   hand back          an approver, or the salesperson the chat was assigned to
 *   see the list       approvers see everything; anyone else sees what was assigned to them
 */
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { reassignCustomerRep } from "@/lib/crm/assignRep";
import { logContactEvent } from "@/lib/crm/contactEvents";
import { ASSIGNABLE_ROLES } from "../leads/logic";
import { isHandoffStatus, type HandoffStatus } from "./logic";

export type HandoffViewer = { id: string; role: string; name: string; approver: boolean };

export type HandoffCard = {
  id: string;
  status: HandoffStatus;
  reason: string;
  summary: string;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  conversation: { id: string; name: string | null; phone: string };
  lead: { id: string; name: string; company: string | null; ownerId: string | null; ownerName: string | null } | null;
  assignedTo: { id: string; name: string } | null;
  decidedBy: { id: string; name: string } | null;
};

export type HandoffOutcome = { ok: true } | { ok: false; status: 400 | 403 | 404 | 409; message: string };

const notFound: HandoffOutcome = { ok: false, status: 404, message: "Request not found." };

export async function listHandoffCards(viewer: HandoffViewer, status: HandoffStatus): Promise<HandoffCard[]> {
  const rows = await prisma.aiHumanHandoff.findMany({
    where: { status, ...(viewer.approver ? {} : { assignedToUserId: viewer.id }) },
    orderBy: { requestedAt: status === "PENDING" ? "asc" : "desc" },
    take: 100,
  });
  if (!rows.length) return [];

  const ids = <T,>(xs: (T | null)[]) => [...new Set(xs.filter((x): x is T => !!x))];
  const [convos, leads, users] = await Promise.all([
    prisma.conversation.findMany({
      where: { id: { in: ids(rows.map((r) => r.conversationId)) } },
      select: { id: true, contactName: true, contactPhone: true },
    }),
    prisma.accountContact.findMany({
      where: { id: { in: ids(rows.map((r) => r.accountContactId)) } },
      select: { id: true, name: true, account: { select: { name: true, ownerUserId: true, owner: { select: { name: true } } } } },
    }),
    prisma.user.findMany({
      where: { id: { in: ids(rows.flatMap((r) => [r.assignedToUserId, r.decidedByUserId])) } },
      select: { id: true, name: true },
    }),
  ]);
  const convoById = new Map(convos.map((c) => [c.id, c]));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const userById = new Map(users.map((u) => [u.id, u]));

  return rows.map((r) => {
    const c = convoById.get(r.conversationId);
    const l = r.accountContactId ? leadById.get(r.accountContactId) : undefined;
    const a = r.assignedToUserId ? userById.get(r.assignedToUserId) : undefined;
    const d = r.decidedByUserId ? userById.get(r.decidedByUserId) : undefined;
    return {
      id: r.id,
      status: (isHandoffStatus(r.status) ? r.status : "PENDING") as HandoffStatus,
      reason: r.reason,
      summary: r.summary,
      requestedAt: r.requestedAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      conversation: { id: r.conversationId, name: c?.contactName ?? null, phone: c?.contactPhone ?? "" },
      lead: l
        ? {
            id: l.id,
            name: l.name,
            company: l.account?.name ?? null,
            ownerId: l.account?.ownerUserId ?? null,
            ownerName: l.account?.owner?.name ?? null,
          }
        : null,
      assignedTo: a ? { id: a.id, name: a.name } : null,
      decidedBy: d ? { id: d.id, name: d.name } : null,
    };
  });
}

export async function countPendingHandoffs(): Promise<number> {
  return prisma.aiHumanHandoff.count({ where: { status: "PENDING" } });
}

/** Active, approved salespeople and managers — the people a chat can go to. */
export async function listAssignees(): Promise<{ id: string; name: string; role: string }[]> {
  return prisma.user.findMany({
    where: { deletedAt: null, isActive: true, approvalStatus: "approved", role: { in: [...ASSIGNABLE_ROLES] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
}

export async function approveHandoff(args: {
  id: string;
  approver: HandoffViewer;
  assignToUserId: string;
  note: string | null;
}): Promise<HandoffOutcome> {
  if (!args.approver.approver) return { ok: false, status: 403, message: "You are not allowed to decide AI requests." };
  const row = await prisma.aiHumanHandoff.findUnique({ where: { id: args.id } });
  if (!row) return notFound;
  if (row.status !== "PENDING") return { ok: false, status: 409, message: "This request was already decided." };

  const rep = await prisma.user.findFirst({
    where: {
      id: args.assignToUserId,
      deletedAt: null,
      isActive: true,
      approvalStatus: "approved",
      role: { in: [...ASSIGNABLE_ROLES] },
    },
    select: { id: true, name: true, pushEnabled: true },
  });
  if (!rep) return { ok: false, status: 400, message: "Pick an active salesperson or manager." };

  // Only the first decision counts, even if two admins click at once.
  const claimed = await prisma.aiHumanHandoff.updateMany({
    where: { id: row.id, status: "PENDING" },
    data: {
      status: "APPROVED",
      assignedToUserId: rep.id,
      decidedByUserId: args.approver.id,
      decidedAt: new Date(),
      decisionNote: args.note,
    },
  });
  if (claimed.count === 0) return { ok: false, status: 409, message: "This request was already decided." };

  // The WhatsApp chat goes to the salesperson's inbox.
  await prisma.conversation.update({ where: { id: row.conversationId }, data: { assignedToUserId: rep.id }, select: { id: true } });

  // The CRM customer follows, through the same path every other rep change uses
  // (open deals, reminders, timeline and push go with it).
  if (row.accountContactId) {
    const lead = await prisma.accountContact.findUnique({ where: { id: row.accountContactId }, select: { accountId: true } });
    if (lead) {
      await reassignCustomerRep({ accountId: lead.accountId, toUserId: rep.id, actorUserId: args.approver.id });
      await logContactEvent({
        contactId: row.accountContactId,
        actorUserId: args.approver.id,
        kind: "escalated",
        summary: `Human handoff approved — chat assigned to ${rep.name}`,
        detail: args.note,
        refId: row.id,
      });
    }
  }

  if (rep.pushEnabled) {
    try {
      await sendPushToUser(rep.id, {
        title: "A customer is waiting for you",
        body: row.reason.slice(0, 140),
        url: `/inbox?conversation=${row.conversationId}`,
        tag: `ai-handoff-${row.id}`,
      });
    } catch {
      // Best effort: the chat is already in their inbox.
    }
  }
  return { ok: true };
}

export async function rejectHandoff(args: { id: string; approver: HandoffViewer; note: string }): Promise<HandoffOutcome> {
  if (!args.approver.approver) return { ok: false, status: 403, message: "You are not allowed to decide AI requests." };
  const row = await prisma.aiHumanHandoff.findUnique({ where: { id: args.id }, select: { id: true, accountContactId: true } });
  if (!row) return notFound;
  const claimed = await prisma.aiHumanHandoff.updateMany({
    where: { id: row.id, status: "PENDING" },
    data: { status: "REJECTED", decidedByUserId: args.approver.id, decidedAt: new Date(), decisionNote: args.note },
  });
  if (claimed.count === 0) return { ok: false, status: 409, message: "This request was already decided." };
  if (row.accountContactId) {
    await logContactEvent({
      contactId: row.accountContactId,
      actorUserId: args.approver.id,
      kind: "escalated",
      summary: "Human handoff declined — the AI agent continues the chat",
      detail: args.note,
      refId: row.id,
    });
  }
  return { ok: true };
}

/** Give an assigned chat back to the AI. */
export async function releaseHandoff(args: { id: string; user: HandoffViewer }): Promise<HandoffOutcome> {
  const row = await prisma.aiHumanHandoff.findUnique({
    where: { id: args.id },
    select: { id: true, status: true, assignedToUserId: true, accountContactId: true },
  });
  if (!row) return notFound;
  if (!args.user.approver && row.assignedToUserId !== args.user.id) {
    return { ok: false, status: 403, message: "Only the assigned salesperson or an admin can hand this chat back." };
  }
  const claimed = await prisma.aiHumanHandoff.updateMany({
    where: { id: row.id, status: "APPROVED" },
    data: { status: "RELEASED", releasedByUserId: args.user.id, releasedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, status: 409, message: "This chat is not currently with a salesperson." };
  if (row.accountContactId) {
    await logContactEvent({
      contactId: row.accountContactId,
      actorUserId: args.user.id,
      kind: "escalated",
      summary: `Chat handed back to the AI agent by ${args.user.name}`,
      refId: row.id,
    });
  }
  return { ok: true };
}
