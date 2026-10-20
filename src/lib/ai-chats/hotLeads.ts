/**
 * Hot leads from AI chats:
 *
 *   checkHotLead(id)   the moment a chat is HOT for the first time, push an alert to
 *                      admins and managers (and the chat's rep, if it has one).
 *                      Called after the AI replies, labels a chat, or asks for a human,
 *                      after a person labels a chat, and from the cron sweep.
 *                      Each chat alerts once (ai_hot_leads.conversation_id is unique).
 *   claimHotLead()     a salesperson takes an unassigned hot chat: it is assigned to
 *                      them in the Inbox, its unowned CRM customer goes to them, and
 *                      the AI goes quiet there (an APPROVED handoff, which they can
 *                      hand back from CRM → AI handoffs).
 */
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { reassignCustomerRep } from "@/lib/crm/assignRep";
import { logContactEvent } from "@/lib/crm/contactEvents";
import { isClaimableBy, recentAiChatRows, scoreOneChat, type AiChatRow, type Viewer } from "./query";

const ALERT_ROLES = ["admin", "manager"];

function headline(row: AiChatRow): string {
  const bits = row.requirements.map((r) => r.value).slice(0, 3);
  return (bits.length ? bits.join(" · ") : row.reason).slice(0, 140) || "Ready to talk";
}

async function pushTo(userIds: string[], payload: { title: string; body: string; url: string; tag: string }) {
  if (!userIds.length) return;
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] }, pushEnabled: true, isActive: true, deletedAt: null },
    select: { id: true },
  });
  await Promise.allSettled(users.map((u) => sendPushToUser(u.id, payload)));
}

async function alertRecipients(extra: (string | null)[] = []): Promise<string[]> {
  const leads = await prisma.user.findMany({
    where: { role: { in: ALERT_ROLES }, isActive: true, deletedAt: null, approvalStatus: "approved" },
    select: { id: true },
  });
  return [...leads.map((u) => u.id), ...extra.filter((x): x is string => !!x)];
}

async function alert(row: AiChatRow): Promise<boolean> {
  const created = await prisma.aiHotLead.createMany({
    data: [{ conversationId: row.conversationId, notifiedAt: new Date() }],
    skipDuplicates: true,
  });
  if (created.count === 0) return false; // already alerted once
  try {
    await pushTo(await alertRecipients([row.assignedToUserId]), {
      title: `🔥 Hot lead: ${row.name || row.phone}`,
      body: row.assignedTo ? `${headline(row)} — with ${row.assignedTo}` : `${headline(row)} — unassigned`,
      url: "/ai-chats",
      tag: `hot-lead-${row.conversationId}`,
    });
  } catch {
    // Best effort: the lead is on the AI agent chats page either way.
  }
  return true;
}

/** Alert the team if this chat has just turned hot. Never throws. */
export async function checkHotLead(conversationId: string): Promise<{ hot: boolean; alerted: boolean }> {
  try {
    const row = await scoreOneChat(conversationId);
    if (!row || row.temperature !== "HOT") return { hot: false, alerted: false };
    return { hot: true, alerted: await alert(row) };
  } catch (err) {
    console.error("[hot-leads] check failed", (err as Error)?.name);
    return { hot: false, alerted: false };
  }
}

/** Cron: catch chats that turned hot without an AI action (e.g. the customer's own messages). */
export async function sweepHotLeads(): Promise<{ alerted: number }> {
  const rows = (await recentAiChatRows()).filter((r) => r.temperature === "HOT");
  if (!rows.length) return { alerted: 0 };
  const done = await prisma.aiHotLead.findMany({
    where: { conversationId: { in: rows.map((r) => r.conversationId) } },
    select: { conversationId: true },
  });
  const seen = new Set(done.map((d) => d.conversationId));
  let alerted = 0;
  for (const row of rows) if (!seen.has(row.conversationId) && (await alert(row))) alerted++;
  return { alerted };
}

export type ClaimOutcome = { ok: true } | { ok: false; status: 403 | 404 | 409; message: string };

export async function claimHotLead(viewer: Viewer & { name: string }, conversationId: string): Promise<ClaimOutcome> {
  const row = await scoreOneChat(conversationId);
  if (!row) return { ok: false, status: 404, message: "Chat not found." };
  if (!isClaimableBy(viewer, row)) {
    if (row.assignedToUserId) return { ok: false, status: 409, message: `Already taken by ${row.assignedTo ?? "someone"}.` };
    if (row.handoffStatus === "PENDING") {
      return { ok: false, status: 409, message: "The customer asked for a person and an admin is choosing who. Ask an admin." };
    }
    if (row.temperature !== "HOT") return { ok: false, status: 409, message: "This chat is no longer hot." };
    return { ok: false, status: 403, message: "Only salespeople and managers can take leads." };
  }

  // First click wins.
  const taken = await prisma.conversation.updateMany({
    where: { id: conversationId, assignedToUserId: null },
    data: { assignedToUserId: viewer.id },
  });
  if (taken.count === 0) return { ok: false, status: 409, message: "Someone else just took this lead." };

  const now = new Date();
  // The AI goes quiet, exactly as after an admin-approved handoff; hand back from CRM → AI handoffs.
  const identity = await prisma.agentIdentity.findFirst({ select: { id: true } });
  const handoff = await prisma.aiHumanHandoff.create({
    data: {
      conversationId,
      accountContactId: row.leadId,
      identityId: identity?.id ?? "team-claim",
      reason: `Hot lead taken by ${viewer.name}`,
      summary: row.requirements.map((r) => `${r.label}: ${r.value}`).join("\n"),
      status: "APPROVED",
      decidedByUserId: viewer.id,
      decidedAt: now,
      decisionNote: "Claimed from WhatsApp Marketing → AI agent chats",
      assignedToUserId: viewer.id,
    },
    select: { id: true },
  });
  await prisma.aiHotLead.upsert({
    where: { conversationId },
    create: { conversationId, claimedByUserId: viewer.id, claimedAt: now },
    update: { claimedByUserId: viewer.id, claimedAt: now },
  });

  // The CRM customer follows only if nobody owns it yet.
  if (row.leadId) {
    const lead = await prisma.accountContact.findUnique({ where: { id: row.leadId }, select: { accountId: true } });
    if (lead) {
      await reassignCustomerRep({ accountId: lead.accountId, toUserId: viewer.id, actorUserId: viewer.id, onlyIfUnowned: true });
      await logContactEvent({
        contactId: row.leadId,
        actorUserId: viewer.id,
        kind: "escalated",
        summary: `Hot lead taken by ${viewer.name} from AI agent chats`,
        refId: handoff.id,
      });
    }
  }

  try {
    const admins = (await alertRecipients()).filter((id) => id !== viewer.id);
    await pushTo(admins, {
      title: `${viewer.name} took a hot lead`,
      body: `${row.name || row.phone}: ${headline(row)}`,
      url: "/ai-chats",
      tag: `hot-lead-${conversationId}`,
    });
  } catch {
    // Best effort.
  }
  return { ok: true };
}
