/**
 * Data for the WhatsApp Marketing → "AI agent chats" page: every chat in which
 * the AI Sales Agent has sent at least one message, with its hot / warm / cold
 * label (see ./scoring.ts).
 *
 * Visibility:
 *   admin, manager, management   every AI chat
 *   anyone else                  AI chats assigned to them, plus UNASSIGNED HOT
 *                                chats, which a salesperson can ask an admin for
 *                                (./hotLeads.ts requestHotLead)
 */
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { canManageAllCustomers, canSeeAllCustomers } from "@/lib/rbac";
import { finalTemperature, scoreChat, type Temperature, type TemperatureSource } from "./scoring";

/** How many of the most recently active AI chats the page loads. */
export const AI_CHATS_LIMIT = 300;
const TEXT_LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000;
const AGENT_PREFIX = "agent.";
/** Roles that can ask for an unassigned hot lead. */
export const REQUESTER_ROLES = ["sales", "manager"];

export type Viewer = { id: string; role: string };

export type AiChatRow = {
  conversationId: string;
  name: string | null;
  phone: string;
  assignedToUserId: string | null;
  assignedTo: string | null;
  aiMessageCount: number;
  customerMessageCount: number;
  lastAiAt: string | null;
  lastCustomerAt: string | null;
  lastActivityAt: string | null;
  temperature: Temperature;
  source: TemperatureSource;
  reason: string;
  score: number;
  signals: string[];
  handoffStatus: string | null;
  /** A request waiting for an admin: the customer's own, or a salesperson's. */
  pendingRequest: { kind: string; requestedBy: string | null } | null;
  leadId: string | null;
  requirements: { label: string; value: string }[];
  /** Filled per viewer by listAiChats: this person may ask an admin for this lead. */
  requestable: boolean;
};

export type AiChatsResult = { rows: AiChatRow[]; counts: Record<Temperature | "ALL", number>; truncated: boolean };

const REQUIREMENT_LABELS: [string, string][] = [
  ["sport", "Sport"],
  ["budgetInr", "Budget (INR)"],
  ["city", "City"],
  ["location", "Location"],
  ["timeline", "Timeline"],
  ["courtLengthFt", "Length (ft)"],
  ["courtWidthFt", "Width (ft)"],
];

const CONVO_SELECT = {
  id: true,
  contactName: true,
  contactPhone: true,
  assignedToUserId: true,
  assignedTo: { select: { name: true } },
} as const;
type ConvoBase = {
  id: string;
  contactName: string | null;
  contactPhone: string;
  assignedToUserId: string | null;
  assignedTo: { name: string } | null;
};

function parseFields(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const maxDate = (...ds: (Date | null | undefined)[]) =>
  ds.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

export function canSeeAllAiChats(role: string): boolean {
  return canSeeAllCustomers(role);
}

/** May this person change a chat's label? Admin/manager, or the rep the chat is assigned to. */
export function canLabelChat(viewer: Viewer, assignedToUserId: string | null): boolean {
  return canManageAllCustomers(viewer.role) || (!!assignedToUserId && assignedToUserId === viewer.id);
}

/** May this person ask for this lead? Sales/manager, the chat is unassigned and hot, and nothing is already waiting or assigned. */
export function isRequestableBy(viewer: Viewer, row: Pick<AiChatRow, "assignedToUserId" | "temperature" | "handoffStatus">): boolean {
  return (
    REQUESTER_ROLES.includes(viewer.role) &&
    !row.assignedToUserId &&
    row.temperature === "HOT" &&
    row.handoffStatus !== "PENDING" &&
    row.handoffStatus !== "APPROVED"
  );
}

export async function aiUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { role: "ai_agent" }, select: { id: true } });
  return users.map((u) => u.id);
}

/** Score these chats (any viewer). Chats the AI never wrote in get aiMessageCount 0. */
async function buildRows(convos: ConvoBase[], agents: string[]): Promise<AiChatRow[]> {
  if (!convos.length) return [];
  const ids = convos.map((c) => c.id);
  const phones = [...new Set(convos.flatMap((c) => [c.contactPhone, normalizePhone(c.contactPhone)]).filter((p): p is string => !!p))];

  const [aiGroups, inGroups, texts, handoffs, insights, contacts, optOuts] = await Promise.all([
    prisma.message.groupBy({
      by: ["conversationId"],
      where: { conversationId: { in: ids }, direction: "outbound", sentByUserId: { in: agents } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.message.groupBy({
      by: ["conversationId"],
      where: { conversationId: { in: ids }, direction: "inbound" },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.message.findMany({
      where: {
        conversationId: { in: ids },
        direction: "inbound",
        body: { not: null },
        createdAt: { gte: new Date(Date.now() - TEXT_LOOKBACK_MS) },
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
      select: { conversationId: true, body: true },
    }),
    prisma.aiHumanHandoff.findMany({
      where: { conversationId: { in: ids } },
      orderBy: { requestedAt: "desc" },
      select: { conversationId: true, status: true, kind: true, requestedByUserId: true },
    }),
    prisma.aiChatInsight.findMany({ where: { conversationId: { in: ids } } }),
    prisma.contact.findMany({
      where: { phone: { in: phones } },
      select: { phone: true, accountContactId: true, accountContact: { select: { fields: true, deletedAt: true } } },
    }),
    prisma.optOut.findMany({ where: { phoneE164: { in: phones } }, select: { phoneE164: true } }),
  ]);

  const aiBy = new Map(aiGroups.map((g) => [g.conversationId, g]));
  const inBy = new Map(inGroups.map((g) => [g.conversationId, g]));
  const textsBy = new Map<string, string[]>();
  for (const t of texts) {
    const list = textsBy.get(t.conversationId) ?? [];
    if (list.length < 40) list.push(t.body ?? "");
    textsBy.set(t.conversationId, list);
  }
  const handoffBy = new Map<string, string>();
  const latestHandoff = new Map<string, (typeof handoffs)[number]>();
  for (const h of handoffs) {
    if (handoffBy.has(h.conversationId)) continue;
    handoffBy.set(h.conversationId, h.status);
    latestHandoff.set(h.conversationId, h);
  }
  const requesterIds = [...new Set(handoffs.map((h) => h.requestedByUserId).filter((x): x is string => !!x))];
  const requesters = requesterIds.length
    ? await prisma.user.findMany({ where: { id: { in: requesterIds } }, select: { id: true, name: true } })
    : [];
  const requesterName = new Map(requesters.map((u) => [u.id, u.name]));
  const insightBy = new Map(insights.map((i) => [i.conversationId, i]));
  const contactByPhone = new Map(contacts.map((c) => [c.phone, c]));
  const optedOut = new Set(optOuts.map((o) => o.phoneE164));

  return convos.map((c) => {
    const ai = aiBy.get(c.id);
    const inbound = inBy.get(c.id);
    const normalized = normalizePhone(c.contactPhone) ?? "";
    const contact = contactByPhone.get(c.contactPhone) ?? contactByPhone.get(normalized);
    const lead = contact?.accountContact && !contact.accountContact.deletedAt ? contact.accountContact : null;
    const fields = parseFields(lead?.fields);
    const has = (k: string) => fields[`${AGENT_PREFIX}${k}`] != null && fields[`${AGENT_PREFIX}${k}`] !== "";
    const requirementKeys = Object.keys(fields)
      .filter((k) => k.startsWith(AGENT_PREFIX))
      .map((k) => k.slice(AGENT_PREFIX.length))
      .filter(has);

    const auto = scoreChat({
      customerTexts: textsBy.get(c.id) ?? [],
      customerMessageCount: inbound?._count._all ?? 0,
      lastCustomerMessageAt: inbound?._max.createdAt ?? null,
      askedForHuman: handoffBy.has(c.id),
      requirementKeys,
      inCrm: !!lead,
      optedOut: optedOut.has(c.contactPhone) || optedOut.has(normalized),
    });
    const final = finalTemperature(auto, insightBy.get(c.id) ?? null);
    const lastAi = ai?._max.createdAt ?? null;
    const lastIn = inbound?._max.createdAt ?? null;

    return {
      conversationId: c.id,
      name: c.contactName,
      phone: c.contactPhone,
      assignedToUserId: c.assignedToUserId,
      assignedTo: c.assignedTo?.name ?? null,
      aiMessageCount: ai?._count._all ?? 0,
      customerMessageCount: inbound?._count._all ?? 0,
      lastAiAt: lastAi?.toISOString() ?? null,
      lastCustomerAt: lastIn?.toISOString() ?? null,
      lastActivityAt: maxDate(lastAi, lastIn)?.toISOString() ?? null,
      temperature: final.temperature,
      source: final.source,
      reason: final.reason,
      score: auto.score,
      signals: auto.signals,
      handoffStatus: handoffBy.get(c.id) ?? null,
      pendingRequest: (() => {
        const h = latestHandoff.get(c.id);
        if (!h || h.status !== "PENDING") return null;
        return { kind: h.kind, requestedBy: h.requestedByUserId ? (requesterName.get(h.requestedByUserId) ?? null) : null };
      })(),
      leadId: lead ? (contact?.accountContactId ?? null) : null,
      requirements: REQUIREMENT_LABELS.filter(([k]) => has(k)).map(([k, label]) => ({
        label,
        value: String(fields[`${AGENT_PREFIX}${k}`]),
      })),
      requestable: false,
    };
  });
}

/** One chat, scored, if the AI has written in it (null otherwise). */
export async function scoreOneChat(conversationId: string): Promise<AiChatRow | null> {
  const agents = await aiUserIds();
  if (!agents.length) return null;
  const convo = await prisma.conversation.findUnique({ where: { id: conversationId }, select: CONVO_SELECT });
  if (!convo) return null;
  const [row] = await buildRows([convo], agents);
  return row && row.aiMessageCount > 0 ? row : null;
}

/** The most recently active AI chats, unfiltered (for the hot-lead sweep). */
export async function recentAiChatRows(limit = AI_CHATS_LIMIT): Promise<AiChatRow[]> {
  const agents = await aiUserIds();
  if (!agents.length) return [];
  const groups = await prisma.message.groupBy({
    by: ["conversationId"],
    where: { direction: "outbound", sentByUserId: { in: agents } },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: limit,
  });
  const convos = await prisma.conversation.findMany({
    where: { id: { in: groups.map((g) => g.conversationId) } },
    select: CONVO_SELECT,
  });
  return buildRows(convos, agents);
}

export async function listAiChats(viewer: Viewer, opts: { q?: string } = {}): Promise<AiChatsResult> {
  const empty: AiChatsResult = { rows: [], counts: { ALL: 0, HOT: 0, WARM: 0, COLD: 0 }, truncated: false };
  const agents = await aiUserIds();
  if (!agents.length) return empty;

  // Chats the AI has written in, most recently active first.
  const aiGroups = await prisma.message.groupBy({
    by: ["conversationId"],
    where: { direction: "outbound", sentByUserId: { in: agents } },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: AI_CHATS_LIMIT,
  });
  if (!aiGroups.length) return empty;

  const seesAll = canSeeAllAiChats(viewer.role);
  const q = opts.q?.trim();
  const convos = await prisma.conversation.findMany({
    where: {
      AND: [
        { id: { in: aiGroups.map((g) => g.conversationId) } },
        // Others: their own chats, plus unassigned ones (only the hot ones are kept below).
        seesAll ? {} : { OR: [{ assignedToUserId: viewer.id }, { assignedToUserId: null }] },
        q ? { OR: [{ contactName: { contains: q, mode: "insensitive" as const } }, { contactPhone: { contains: q } }] } : {},
      ],
    },
    select: CONVO_SELECT,
  });

  let rows = await buildRows(convos, agents);
  if (!seesAll) rows = rows.filter((r) => r.assignedToUserId === viewer.id || (!r.assignedToUserId && r.temperature === "HOT"));
  for (const r of rows) r.requestable = isRequestableBy(viewer, r);

  const rank: Record<Temperature, number> = { HOT: 0, WARM: 1, COLD: 2 };
  rows.sort(
    (a, b) =>
      rank[a.temperature] - rank[b.temperature] || (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""),
  );
  const counts = { ALL: rows.length, HOT: 0, WARM: 0, COLD: 0 };
  for (const r of rows) counts[r.temperature]++;
  return { rows, counts, truncated: aiGroups.length >= AI_CHATS_LIMIT };
}

/** The conversation, if this person may see it on the AI chats page. */
export async function findVisibleChat(viewer: Viewer, conversationId: string) {
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, assignedToUserId: true },
  });
  if (!convo) return null;
  if (canSeeAllAiChats(viewer.role) || convo.assignedToUserId === viewer.id) return convo;
  // Unassigned hot chats are open to everyone who can ask for them.
  if (!convo.assignedToUserId) {
    const row = await scoreOneChat(convo.id);
    if (row?.temperature === "HOT") return convo;
  }
  return null;
}

/** The last messages of one chat, labelled customer / AI / staff. */
export async function chatTranscript(conversationId: string, limit = 60) {
  const agents = new Set(await aiUserIds());
  const msgs = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      direction: true,
      type: true,
      body: true,
      createdAt: true,
      sentByUserId: true,
      sentBy: { select: { name: true } },
    },
  });
  return msgs.reverse().map((m) => {
    const isAi = m.direction === "outbound" && !!m.sentByUserId && agents.has(m.sentByUserId);
    return {
      id: m.id,
      from: m.direction === "inbound" ? ("customer" as const) : isAi ? ("ai" as const) : ("staff" as const),
      staffName: m.direction === "outbound" && !isAi ? (m.sentBy?.name ?? null) : null,
      type: m.type,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    };
  });
}
