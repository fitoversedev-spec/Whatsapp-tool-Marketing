/**
 * The human side of handing AI leads to sales: list the requests, approve one
 * by assigning a salesperson, assign a chat directly, decline a request (the
 * AI carries on), or release a lead.
 *
 * Who may do what:
 *   approve / decline / assign   an AI approver (Setting agent_approvers; admins by default)
 *   release                      an approver, or the salesperson the lead was assigned to
 *   see the list                 approvers see everything; anyone else sees what was
 *                                assigned to them and what they asked for
 */
import { prisma } from "@/lib/prisma";
import { logContactEvent } from "@/lib/crm/contactEvents";
import { ASSIGNABLE_ROLES } from "../leads/logic";
import { applyAssignment, type Rep } from "./assign";
import { HANDOFF_KINDS, isHandoffStatus, type HandoffKind, type HandoffStatus } from "./logic";

export type HandoffViewer = { id: string; role: string; name: string; approver: boolean };

export type HandoffCard = {
  id: string;
  status: HandoffStatus;
  kind: HandoffKind;
  reason: string;
  summary: string;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  conversation: { id: string; name: string | null; phone: string };
  lead: { id: string; name: string; company: string | null; ownerId: string | null; ownerName: string | null } | null;
  assignedTo: { id: string; name: string } | null;
  requestedBy: { id: string; name: string } | null;
  decidedBy: { id: string; name: string } | null;
};

export type HandoffOutcome = { ok: true } | { ok: false; status: 400 | 403 | 404 | 409; message: string };

const notFound: HandoffOutcome = { ok: false, status: 404, message: "Request not found." };
const notApprover: HandoffOutcome = { ok: false, status: 403, message: "You are not allowed to decide AI requests." };

export async function listHandoffCards(viewer: HandoffViewer, status: HandoffStatus): Promise<HandoffCard[]> {
  const rows = await prisma.aiHumanHandoff.findMany({
    where: {
      status,
      ...(viewer.approver ? {} : { OR: [{ assignedToUserId: viewer.id }, { requestedByUserId: viewer.id }] }),
    },
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
      where: { id: { in: ids(rows.flatMap((r) => [r.assignedToUserId, r.decidedByUserId, r.requestedByUserId])) } },
      select: { id: true, name: true },
    }),
  ]);
  const convoById = new Map(convos.map((c) => [c.id, c]));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const person = (id: string | null) => {
    const u = id ? userById.get(id) : undefined;
    return u ? { id: u.id, name: u.name } : null;
  };

  return rows.map((r) => {
    const c = convoById.get(r.conversationId);
    const l = r.accountContactId ? leadById.get(r.accountContactId) : undefined;
    return {
      id: r.id,
      status: (isHandoffStatus(r.status) ? r.status : "PENDING") as HandoffStatus,
      kind: ((HANDOFF_KINDS as readonly string[]).includes(r.kind) ? r.kind : "CUSTOMER_REQUEST") as HandoffKind,
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
      assignedTo: person(r.assignedToUserId),
      requestedBy: person(r.requestedByUserId),
      decidedBy: person(r.decidedByUserId),
    };
  });
}

export async function countPendingHandoffs(): Promise<number> {
  return prisma.aiHumanHandoff.count({ where: { status: "PENDING" } });
}

/** Active, approved salespeople and managers — the people a lead can go to. */
export async function listAssignees(): Promise<{ id: string; name: string; role: string }[]> {
  return prisma.user.findMany({
    where: { deletedAt: null, isActive: true, approvalStatus: "approved", role: { in: [...ASSIGNABLE_ROLES] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
}

async function loadRep(userId: string): Promise<Rep | null> {
  return prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true, approvalStatus: "approved", role: { in: [...ASSIGNABLE_ROLES] } },
    select: { id: true, name: true, phone: true, pushEnabled: true },
  });
}

/** Approve a PENDING request (the customer's or a salesperson's) and assign the lead. */
export async function approveHandoff(args: {
  id: string;
  approver: HandoffViewer;
  assignToUserId: string;
  note: string | null;
}): Promise<HandoffOutcome> {
  if (!args.approver.approver) return notApprover;
  const row = await prisma.aiHumanHandoff.findUnique({ where: { id: args.id } });
  if (!row) return notFound;
  if (row.status !== "PENDING") return { ok: false, status: 409, message: "This request was already decided." };
  const rep = await loadRep(args.assignToUserId);
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
  await applyAssignment({ handoff: row, rep, actorUserId: args.approver.id, note: args.note });
  return { ok: true };
}

/**
 * An admin assigns an AI chat straight from the AI agent chats page. A waiting
 * request on the chat is approved with this salesperson; otherwise a new,
 * already-approved ADMIN_ASSIGN record is made.
 */
export async function assignChat(args: {
  conversationId: string;
  approver: HandoffViewer;
  assignToUserId: string;
  note: string | null;
}): Promise<HandoffOutcome> {
  if (!args.approver.approver) return notApprover;
  const open = await prisma.aiHumanHandoff.findFirst({
    where: { conversationId: args.conversationId, status: { in: ["PENDING", "APPROVED"] } },
    orderBy: { requestedAt: "desc" },
    select: { id: true, status: true },
  });
  if (open?.status === "APPROVED") {
    return { ok: false, status: 409, message: "This lead already has a salesperson. Release it first to reassign." };
  }
  if (open) return approveHandoff({ id: open.id, approver: args.approver, assignToUserId: args.assignToUserId, note: args.note });

  const convo = await prisma.conversation.findUnique({ where: { id: args.conversationId }, select: { id: true, contactPhone: true } });
  if (!convo) return { ok: false, status: 404, message: "Chat not found." };
  const rep = await loadRep(args.assignToUserId);
  if (!rep) return { ok: false, status: 400, message: "Pick an active salesperson or manager." };
  const [identity, contact] = await Promise.all([
    prisma.agentIdentity.findFirst({ select: { id: true } }),
    prisma.contact.findFirst({ where: { phone: convo.contactPhone }, select: { accountContactId: true } }),
  ]);
  const now = new Date();
  const row = await prisma.aiHumanHandoff.create({
    data: {
      conversationId: convo.id,
      accountContactId: contact?.accountContactId ?? null,
      identityId: identity?.id ?? "admin-assign",
      kind: "ADMIN_ASSIGN",
      reason: `Assigned by ${args.approver.name}`,
      summary: "",
      status: "APPROVED",
      assignedToUserId: rep.id,
      decidedByUserId: args.approver.id,
      decidedAt: now,
      decisionNote: args.note,
    },
  });
  await applyAssignment({ handoff: row, rep, actorUserId: args.approver.id, note: args.note });
  return { ok: true };
}

export async function rejectHandoff(args: { id: string; approver: HandoffViewer; note: string }): Promise<HandoffOutcome> {
  if (!args.approver.approver) return notApprover;
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
      summary: "Request for this AI lead declined — the AI agent continues the chat",
      detail: args.note,
      refId: row.id,
    });
  }
  return { ok: true };
}

/** End a salesperson's ownership of an AI lead. The AI keeps chatting either way. */
export async function releaseHandoff(args: { id: string; user: HandoffViewer }): Promise<HandoffOutcome> {
  const row = await prisma.aiHumanHandoff.findUnique({
    where: { id: args.id },
    select: { id: true, status: true, assignedToUserId: true, accountContactId: true },
  });
  if (!row) return notFound;
  if (!args.user.approver && row.assignedToUserId !== args.user.id) {
    return { ok: false, status: 403, message: "Only the assigned salesperson or an admin can release this lead." };
  }
  const claimed = await prisma.aiHumanHandoff.updateMany({
    where: { id: row.id, status: "APPROVED" },
    data: { status: "RELEASED", releasedByUserId: args.user.id, releasedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, status: 409, message: "This lead is not currently with a salesperson." };
  if (row.accountContactId) {
    await logContactEvent({
      contactId: row.accountContactId,
      actorUserId: args.user.id,
      kind: "escalated",
      summary: `AI lead released by ${args.user.name}`,
      refId: row.id,
    });
  }
  return { ok: true };
}
