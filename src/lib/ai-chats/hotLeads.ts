/**
 * Hot leads from AI chats:
 *
 *   checkHotLead(id)   the moment a chat is HOT for the first time, push an alert to
 *                      admins and managers (and the chat's rep, if it has one).
 *                      Called after the AI replies, labels a chat, or asks for a human,
 *                      after a person labels a chat, and from the cron sweep.
 *                      Each chat alerts once (ai_hot_leads.conversation_id is unique).
 *   requestHotLead()   a salesperson asks for an unassigned hot chat; an admin approves
 *                      it on CRM → AI handoffs (src/lib/agent/handoffs/admin.ts).
 *   afterAiReply()     after each AI reply: the hot check, and the reply pushed to the
 *                      salesperson who owns the lead.
 */
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { loadApproverConfig } from "@/lib/agent/approvals";
import { conveyToSales } from "@/lib/agent/handoffs/assign";
import { adoptExistingOwner } from "./owners";
import { isRequestableBy, recentAiChatRows, scoreOneChat, type AiChatRow, type Viewer } from "./query";

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
  for (const row of rows) {
    if (seen.has(row.conversationId)) continue;
    // An already-owned customer is linked first, so the alert names their salesperson.
    const owner = !row.assignedToUserId && !row.handoffStatus ? await adoptExistingOwner(row.conversationId) : null;
    const current = owner ? { ...row, assignedToUserId: owner.userId, assignedTo: owner.name } : row;
    if (await alert(current)) alerted++;
  }
  return { alerted };
}

export type RequestOutcome = { ok: true } | { ok: false; status: 403 | 404 | 409; message: string };

/**
 * A salesperson asks for an unassigned hot lead. It waits on CRM → AI handoffs
 * until an admin approves (assigning it to them, or someone else) or declines.
 * The AI keeps chatting meanwhile.
 */
export async function requestHotLead(viewer: Viewer & { name: string }, conversationId: string): Promise<RequestOutcome> {
  // Never a second owner: a customer someone already has goes to them.
  const owner = await adoptExistingOwner(conversationId);
  if (owner) return { ok: false, status: 409, message: `Already ${owner.name}'s customer.` };
  const row = await scoreOneChat(conversationId);
  if (!row) return { ok: false, status: 404, message: "Chat not found." };
  if (!isRequestableBy(viewer, row)) {
    if (row.assignedToUserId || row.handoffStatus === "APPROVED") {
      return { ok: false, status: 409, message: `Already assigned to ${row.assignedTo ?? "someone"}.` };
    }
    if (row.handoffStatus === "PENDING") return { ok: false, status: 409, message: "A request for this lead is already waiting for an admin." };
    if (row.temperature !== "HOT") return { ok: false, status: 409, message: "This chat is no longer hot." };
    return { ok: false, status: 403, message: "Only salespeople and managers can ask for leads." };
  }

  const identity = await prisma.agentIdentity.findFirst({ select: { id: true } });
  await prisma.aiHumanHandoff.create({
    data: {
      conversationId,
      accountContactId: row.leadId,
      identityId: identity?.id ?? "sales-request",
      kind: "SALES_REQUEST",
      requestedByUserId: viewer.id,
      reason: `${viewer.name} asked for this hot lead`,
      summary: row.requirements.map((r) => `${r.label}: ${r.value}`).join("\n"),
      status: "PENDING",
    },
  });

  try {
    const cfg = await loadApproverConfig();
    const approvers = await prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        role: { not: "ai_agent" },
        OR: [{ role: { in: cfg.roles } }, { id: { in: cfg.userIds } }],
      },
      select: { id: true },
    });
    await pushTo(
      approvers.map((u) => u.id).filter((id) => id !== viewer.id),
      {
        title: `${viewer.name} asks for a hot lead`,
        body: `${row.name || row.phone}: ${headline(row)}`,
        url: "/crm/ai-handoffs",
        tag: `lead-request-${conversationId}`,
      },
    );
  } catch {
    // Best effort: the request is on CRM → AI handoffs.
  }
  return { ok: true };
}

/**
 * Run after every AI reply: alert the team if the chat just turned hot, and
 * pass the reply on to the salesperson who owns the lead. Never throws.
 */
export async function afterAiReply(conversationId: string, text: string): Promise<void> {
  await adoptExistingOwner(conversationId);
  await checkHotLead(conversationId);
  await conveyToSales(conversationId, text);
}
