import { prisma } from "@/lib/prisma";
import type { ApprovalRow } from "./approvals";
import { formatInr, formatWhen } from "./approvalFormat";
import { renderTemplateText } from "./messaging/templates";

/**
 * Turns a stored approval request into something a person can read: a plain
 * title, the exact details (amounts, message text), and which customer it is
 * about. Pure formatting is in describeApproval(); buildApprovalCards() adds the
 * database lookups (lead / chat / person / template names) in a few batched queries.
 *
 * Tools we do not know by name still work: their fields are listed as
 * "Label: value" so nothing the AI asked for is ever hidden from the approver.
 */

export type ApprovalDetail = { label: string; value: string; long?: boolean };
export type ApprovalCustomer = {
  kind: "lead" | "chat";
  id: string;
  name: string | null;
  phone: string | null;
  company: string | null;
  href: string;
  role: string;
};
export type Lookups = {
  leads: Map<string, { name: string; phone: string | null; company: string | null }>;
  chats: Map<string, { name: string | null; phone: string }>;
  users: Map<string, string>;
  templates: Map<string, { name: string; body: string }>;
};
export const emptyLookups = (): Lookups => ({
  leads: new Map(),
  chats: new Map(),
  users: new Map(),
  templates: new Map(),
});

export const TOOL_TITLES: Record<string, string> = {
  update_lead_phone: "Change a phone number",
  remove_from_leads: "Remove from Leads",
  reassign_lead: "Give to another salesperson",
  request_merge: "Merge duplicate leads",
  request_mark_won: "Move to deal",
  send_reply: "Send a WhatsApp message",
  send_template: "Send a WhatsApp template",
  send_marketing_template: "Send a marketing message",
  approve_quote: "Approve a quotation",
  request_discount: "Give a discount",
  set_deal_execution_status: "Change a deal's work status",
  update_deal_won_value: "Change a deal's value",
  launch_broadcast: "Start a broadcast",
  schedule_broadcast: "Schedule a broadcast",
};

export function toolTitle(toolName: string): string {
  if (Object.prototype.hasOwnProperty.call(TOOL_TITLES, toolName)) return TOOL_TITLES[toolName];
  const words = toolName.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "AI request";
}

const GUARD_WORDS: Record<string, string> = {
  price: "a price",
  discount: "a discount",
  commitment: "a promise (date, warranty or guarantee)",
};

const LABELS: Record<string, string> = {
  phone: "New phone number",
  reason: "Reason",
  note: "Note",
  value: "Deal value",
  expectedStartAt: "Expected start",
  text: "Message",
  reference: "AI reference",
  variables: "Values filled in",
  stageId: "Stage",
  dueAt: "Due",
};

const HIDDEN_KEYS = new Set(["leadId", "primaryLeadId", "duplicateLeadIds", "conversationId", "templateId", "userId", "categories"]);
const MONEY_KEY = /(value|amount|budget|price|total|cost)/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function humaniseKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim().toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

function formatValue(key: string, v: unknown): { value: string; long: boolean } | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return { value: MONEY_KEY.test(key) ? formatInr(v) : String(v), long: false };
  if (typeof v === "boolean") return { value: v ? "Yes" : "No", long: false };
  if (typeof v === "string") {
    if (ISO_DATE.test(v)) return { value: formatWhen(v), long: false };
    const value = clip(v, 2000);
    return { value, long: value.length > 80 || value.includes("\n") };
  }
  if (Array.isArray(v)) {
    const items = v.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
    return items.length ? { value: clip(items.join(", "), 1000), long: items.join(", ").length > 80 } : null;
  }
  return { value: clip(JSON.stringify(v), 800), long: true };
}

/** Ids mentioned in a stored request, grouped by what they point at. */
export function collectRefs(input: unknown): { leadIds: string[]; chatIds: string[]; userIds: string[]; templateIds: string[] } {
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const str = (v: unknown): string[] => (typeof v === "string" && v ? [v] : []);
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    leadIds: [...new Set([...str(o.leadId), ...str(o.primaryLeadId), ...list(o.duplicateLeadIds)])],
    chatIds: str(o.conversationId),
    userIds: str(o.userId),
    templateIds: str(o.templateId),
  };
}

export function describeApproval(
  toolName: string,
  input: unknown,
  lookups: Lookups,
): { title: string; details: ApprovalDetail[]; customers: ApprovalCustomer[] } {
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const details: ApprovalDetail[] = [];
  const customers: ApprovalCustomer[] = [];

  const lead = (id: unknown, role: string) => {
    if (typeof id !== "string" || !id) return;
    const l = lookups.leads.get(id);
    customers.push({ kind: "lead", id, name: l?.name ?? null, phone: l?.phone ?? null, company: l?.company ?? null, href: `/crm/contacts/${id}`, role });
  };
  const isMerge = Array.isArray(o.duplicateLeadIds);
  lead(o.leadId, "Customer");
  lead(o.primaryLeadId, "Keep this one");
  if (isMerge) for (const id of o.duplicateLeadIds as unknown[]) lead(id, "Duplicate");

  if (typeof o.conversationId === "string" && o.conversationId) {
    const c = lookups.chats.get(o.conversationId);
    customers.push({ kind: "chat", id: o.conversationId, name: c?.name ?? null, phone: c?.phone ?? null, company: null, href: `/inbox?conversation=${o.conversationId}`, role: "Sent to" });
  }

  // The words being sent come first: that is what the approver is really judging.
  const template = typeof o.templateId === "string" ? lookups.templates.get(o.templateId) : undefined;
  if (template) {
    const vars = Array.isArray(o.variables) ? o.variables.map(String) : [];
    details.push({ label: "Template", value: template.name });
    details.push({ label: "Message", value: clip(renderTemplateText(template.body, vars), 2000), long: true });
  } else if (typeof o.templateId === "string") {
    details.push({ label: "Template", value: "(not found)" });
  }
  if (typeof o.userId === "string") {
    details.push({ label: toolName === "reassign_lead" ? "Give to" : "Person", value: lookups.users.get(o.userId) ?? "(unknown person)" });
  }

  const guardList = Array.isArray(o.categories) ? o.categories.map((c) => GUARD_WORDS[String(c)] ?? String(c)) : [];
  if (guardList.length) details.push({ label: "Why it is waiting", value: `The message mentions ${guardList.join(", ")}.` });

  for (const [key, raw] of Object.entries(o)) {
    if (HIDDEN_KEYS.has(key)) continue;
    // The guard's own code word: the sentence above already says it.
    if (key === "reason" && typeof raw === "string" && raw.startsWith("needs_approval_")) continue;
    // With a template the raw values are already shown inside the message.
    if (key === "variables" && template) continue;
    const f = formatValue(key, raw);
    if (!f) continue;
    details.push({ label: LABELS[key] ?? humaniseKey(key), value: f.value, long: f.long });
  }

  return { title: toolTitle(toolName), details, customers };
}

// ── cards for the page / API ────────────────────────────────────────────────

export type ApprovalOutcome = "done" | "failed" | "not_run" | "running" | null;
export type ApprovalCard = {
  id: string;
  toolName: string;
  title: string;
  details: ApprovalDetail[];
  customers: ApprovalCustomer[];
  /** pending | approved | rejected | expired (executed/failed/approved all show as approved). */
  status: "pending" | "approved" | "rejected" | "expired";
  outcome: ApprovalOutcome;
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  failureReason: string | null;
};

export function displayStatus(row: Pick<ApprovalRow, "status" | "expiresAt">, now = Date.now()): ApprovalCard["status"] {
  switch (row.status) {
    case "pending":
      return row.expiresAt.getTime() <= now ? "expired" : "pending";
    case "rejected":
      return "rejected";
    case "expired":
      return "expired";
    default:
      return "approved"; // approved, executed, failed
  }
}

export function outcomeOf(row: Pick<ApprovalRow, "status" | "failureReason">): ApprovalOutcome {
  if (row.status === "executed") return "done";
  if (row.status === "failed") return "failed";
  if (row.status === "approved") return row.failureReason ? "not_run" : "running";
  return null;
}

async function loadLookups(rows: ApprovalRow[]): Promise<{ lookups: Lookups; deciders: Map<string, string> }> {
  const leadIds = new Set<string>();
  const chatIds = new Set<string>();
  const userIds = new Set<string>();
  const templateIds = new Set<string>();
  for (const r of rows) {
    const refs = collectRefs(r.inputJson);
    refs.leadIds.forEach((x) => leadIds.add(x));
    refs.chatIds.forEach((x) => chatIds.add(x));
    refs.userIds.forEach((x) => userIds.add(x));
    refs.templateIds.forEach((x) => templateIds.add(x));
    if (r.decidedByUserId) userIds.add(r.decidedByUserId);
  }
  const [leads, chats, users, templates] = await Promise.all([
    leadIds.size
      ? prisma.accountContact.findMany({
          where: { id: { in: [...leadIds] } },
          select: { id: true, name: true, phone: true, account: { select: { name: true } } },
        })
      : [],
    chatIds.size
      ? prisma.conversation.findMany({ where: { id: { in: [...chatIds] } }, select: { id: true, contactName: true, contactPhone: true } })
      : [],
    userIds.size ? prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }) : [],
    templateIds.size ? prisma.template.findMany({ where: { id: { in: [...templateIds] } }, select: { id: true, name: true, body: true } }) : [],
  ]);
  const lookups = emptyLookups();
  for (const l of leads) lookups.leads.set(l.id, { name: l.name, phone: l.phone, company: l.account?.name ?? null });
  for (const c of chats) lookups.chats.set(c.id, { name: c.contactName, phone: c.contactPhone });
  for (const u of users) lookups.users.set(u.id, u.name);
  for (const t of templates) lookups.templates.set(t.id, { name: t.name, body: t.body });
  return { lookups, deciders: lookups.users };
}

export async function buildApprovalCards(rows: ApprovalRow[]): Promise<ApprovalCard[]> {
  if (!rows.length) return [];
  const { lookups, deciders } = await loadLookups(rows);
  const now = Date.now();
  return rows.map((r) => {
    const d = describeApproval(r.toolName, r.inputJson, lookups);
    return {
      id: r.id,
      toolName: r.toolName,
      title: d.title,
      details: d.details,
      customers: d.customers,
      status: displayStatus(r, now),
      outcome: outcomeOf(r),
      requestedAt: r.requestedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decidedByName: r.decidedByUserId ? (deciders.get(r.decidedByUserId) ?? null) : null,
      decisionNote: r.decisionNote,
      failureReason: r.failureReason,
    };
  });
}

export type ApprovalTab = "pending" | "approved" | "rejected" | "expired";
export const APPROVAL_TABS: readonly ApprovalTab[] = ["pending", "approved", "rejected", "expired"];
const LIST_LIMIT = 100;

/** One tab of the approvals list, newest decisions first (pending: oldest first, so nothing waits forever). */
export async function listApprovalCards(tab: ApprovalTab): Promise<{ items: ApprovalCard[]; pendingCount: number }> {
  const now = new Date();
  const where =
    tab === "pending"
      ? { status: "pending", expiresAt: { gt: now } }
      : tab === "approved"
        ? { status: { in: ["approved", "executed", "failed"] } }
        : tab === "rejected"
          ? { status: "rejected" }
          : { OR: [{ status: "expired" }, { status: "pending", expiresAt: { lte: now } }] };
  const orderBy =
    tab === "pending" ? { requestedAt: "asc" as const } : tab === "expired" ? { expiresAt: "desc" as const } : { decidedAt: "desc" as const };
  const [rows, pendingCount] = await Promise.all([
    prisma.agentApprovalRequest.findMany({ where, orderBy, take: LIST_LIMIT }),
    prisma.agentApprovalRequest.count({ where: { status: "pending", expiresAt: { gt: now } } }),
  ]);
  return { items: await buildApprovalCards(rows as ApprovalRow[]), pendingCount };
}
