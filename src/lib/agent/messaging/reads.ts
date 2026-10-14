import type { Prisma } from "@prisma/client";
import type { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { AgentHttpError } from "../errors";
import type { AgentHandler } from "../withAgent";
import type {
  getEventsQuery,
  getMessagesQuery,
  listConversationsQuery,
  listTemplatesQuery,
} from "../schemas/messaging";
import { iso, loadEligibility, MESSAGE_SELECT, parseId, toMessageDto } from "./access";
import { isWindowOpen, WINDOW_MS } from "./eligibility";
import {
  checkEventStart,
  decodeCursor,
  encodeCursor,
  mergeEvents,
  parseEventTypes,
  type FeedEvent,
} from "./events";
import { expectedVariableCount, extractPlaceholders, isApprovedStatus, usableWith } from "./templates";

/** Read-only tools. Nothing here writes, and nothing marks a conversation read. */

// ---- list_conversations ----------------------------------------------------

export const listConversationsHandler: AgentHandler<z.infer<typeof listConversationsQuery>> = async ({ input }) => {
  const now = Date.now();
  const cur = input.cursor ? decodeCursor(input.cursor) : null;
  if (input.cursor && !cur) throw new AgentHttpError("invalid_input", "Invalid cursor.");

  // Only people who have written to us: outbound-only broadcast recipients are
  // not conversations to answer (and would swamp the list).
  const and: Prisma.ConversationWhereInput[] = [{ lastInboundAt: { not: null } }];
  if (input.status) and.push({ status: input.status });
  if (input.q) {
    const digits = input.q.replace(/\D/g, "");
    and.push({
      OR: [
        { contactName: { contains: input.q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ contactPhone: { contains: digits } }] : []),
      ],
    });
  }
  if (cur) {
    const t = new Date(cur.t);
    and.push({ OR: [{ lastInboundAt: { lt: t } }, { lastInboundAt: t, id: { lt: cur.id } }] });
  }

  const rows = await prisma.conversation.findMany({
    where: { AND: and },
    orderBy: [{ lastInboundAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: {
      id: true,
      contactName: true,
      contactPhone: true,
      status: true,
      unreadCount: true,
      lastInboundAt: true,
      lastOutboundAt: true,
      assignedToUserId: true,
    },
  });
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  const optedOut = new Set<string>();
  if (page.length) {
    const opt = await prisma.optOut.findMany({
      where: { phoneE164: { in: page.map((r) => r.contactPhone) } },
      select: { phoneE164: true },
    });
    for (const o of opt) optedOut.add(o.phoneE164);
  }

  const last = page[page.length - 1];
  return {
    body: {
      conversations: page.map((c) => {
        const inbound = c.lastInboundAt?.getTime() ?? 0;
        const outbound = c.lastOutboundAt?.getTime() ?? 0;
        return {
          id: c.id,
          contactName: c.contactName,
          phone: c.contactPhone,
          status: c.status,
          unreadCount: c.unreadCount,
          lastInboundAt: iso(c.lastInboundAt),
          lastOutboundAt: iso(c.lastOutboundAt),
          lastMessageAt: new Date(Math.max(inbound, outbound)).toISOString(),
          windowOpen: isWindowOpen(c.lastInboundAt, now),
          windowEndsAt: c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + WINDOW_MS).toISOString() : null,
          optedOut: optedOut.has(c.contactPhone),
          assignedToHuman: !!c.assignedToUserId,
        };
      }),
      nextCursor: hasMore && last?.lastInboundAt ? encodeCursor({ t: last.lastInboundAt, id: last.id }) : null,
    },
    recordIds: page.map((c) => c.id),
  };
};

// ---- get_messages ----------------------------------------------------------

export const getMessagesHandler: AgentHandler<z.infer<typeof getMessagesQuery>> = async ({ ctx, input, params }) => {
  const id = parseId(params.id);
  const convo = await prisma.conversation.findUnique({ where: { id }, select: { id: true, lastInboundAt: true } });
  if (!convo) throw new AgentHttpError("not_found", "Conversation not found.");

  const before = input.before ? new Date(input.before) : null;
  const rows = await prisma.message.findMany({
    where: { conversationId: id, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: "desc" },
    take: input.limit + 1,
    select: MESSAGE_SELECT,
  });
  const hasMore = rows.length > input.limit;
  const page = (hasMore ? rows.slice(0, input.limit) : rows).reverse(); // oldest first

  // Unlike the human inbox, reading here NEVER resets unreadCount: the team's
  // "unread" badge only clears when a person opens the chat.
  return {
    body: {
      conversationId: id,
      windowOpen: isWindowOpen(convo.lastInboundAt, Date.now()),
      hasMore,
      nextBefore: hasMore && page.length ? page[0].createdAt.toISOString() : null,
      messages: page.map((m) => toMessageDto(m, ctx.userId)),
    },
    recordIds: [id],
  };
};

// ---- get_send_eligibility --------------------------------------------------

export const getEligibilityHandler: AgentHandler<unknown> = async ({ params }) => {
  const id = parseId(params.id);
  const convo = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, contactPhone: true, lastInboundAt: true },
  });
  if (!convo) throw new AgentHttpError("not_found", "Conversation not found.");
  const elig = await loadEligibility(convo);
  return { body: { conversationId: id, ...elig }, recordIds: [id] };
};

// ---- list_templates --------------------------------------------------------

export const listTemplatesHandler: AgentHandler<z.infer<typeof listTemplatesQuery>> = async ({ input }) => {
  const rows = await prisma.template.findMany({
    where: { deletedAt: null },
    orderBy: [{ name: "asc" }, { language: "asc" }],
    take: 400,
    select: { id: true, name: true, language: true, category: true, body: true, status: true },
  });
  const templates = rows
    .filter((t) => isApprovedStatus(t.status) && usableWith(t.category) !== null)
    .filter((t) => !input.category || t.category.trim().toUpperCase() === input.category)
    .map((t) => ({
      id: t.id,
      name: t.name,
      language: t.language,
      category: t.category.trim().toUpperCase(),
      body: t.body,
      variables: extractPlaceholders(t.body),
      variableCount: expectedVariableCount(t.body),
      usableWith: usableWith(t.category)!,
    }));
  return { body: { templates } };
};

// ---- get_events ------------------------------------------------------------

const EVENT_BODY_MAX = 1000;
// conversation.lastInboundAt is written a moment around the message row; the
// slack keeps the (index-friendly) pre-filter from ever hiding a real message.
const LAST_INBOUND_SLACK_MS = 5 * 60 * 1000;

type FeedItem = FeedEvent & {
  source: "whatsapp" | "crm" | "ad";
  conversationId?: string;
  messageType?: string;
  body?: string | null;
  name?: string | null;
  phone?: string | null;
  city?: string | null;
  sport?: string | null;
  campaignName?: string | null;
};

export const getEventsHandler: AgentHandler<z.infer<typeof getEventsQuery>> = async ({ input }) => {
  const now = Date.now();
  const types = parseEventTypes(input.types);
  if (!types) throw new AgentHttpError("invalid_input", "`types` must be a comma-separated list of: message, lead.");
  const cur = input.cursor ? decodeCursor(input.cursor) : null;
  if (input.cursor && !cur) throw new AgentHttpError("invalid_input", "Invalid cursor.");

  // A cursor says exactly where the last page stopped; `since` only starts a fresh feed.
  const start = cur ? new Date(cur.t) : new Date(input.since!);
  const age = checkEventStart(start, now);
  if (!age.ok) {
    throw new AgentHttpError(
      "invalid_input",
      `Events are only available for the last 7 days; the earliest allowed start is ${age.earliest}.`,
    );
  }

  // (time, id) keyset: strictly after the cursor, or from `since` on a fresh feed.
  const after = (field: "createdAt" | "promotedToLeadAt") =>
    cur
      ? {
          OR: [
            { [field]: { gt: new Date(cur.t) } },
            { [field]: new Date(cur.t), id: { gt: cur.id } },
          ],
        }
      : { [field]: { gte: start } };
  const order = [{ createdAt: "asc" as const }, { id: "asc" as const }];
  const take = input.limit + 1;
  const lists: FeedItem[][] = [];
  const queries: Promise<void>[] = [];

  if (types.includes("message")) {
    queries.push(
      prisma.message
        .findMany({
          where: {
            AND: [
              { direction: "inbound" },
              { conversation: { lastInboundAt: { gte: new Date(start.getTime() - LAST_INBOUND_SLACK_MS) } } },
              after("createdAt"),
            ],
          } as Prisma.MessageWhereInput,
          orderBy: order,
          take,
          select: {
            id: true,
            createdAt: true,
            type: true,
            body: true,
            conversationId: true,
            conversation: { select: { contactName: true, contactPhone: true } },
          },
        })
        .then((rows) => {
          lists.push(
            rows.map((m) => ({
              type: "message" as const,
              source: "whatsapp" as const,
              id: m.id,
              at: m.createdAt.toISOString(),
              conversationId: m.conversationId,
              messageType: m.type,
              body: m.body ? m.body.slice(0, EVENT_BODY_MAX) : null,
              name: m.conversation.contactName,
              phone: m.conversation.contactPhone,
            })),
          );
        }),
    );
  }

  if (types.includes("lead")) {
    const crmSelect = { id: true, name: true, phone: true, createdAt: true, promotedToLeadAt: true } as const;
    const crmItem = (c: { id: string; name: string; phone: string | null; createdAt: Date; promotedToLeadAt: Date | null }) => ({
      type: "lead" as const,
      source: "crm" as const,
      id: c.id,
      at: (c.promotedToLeadAt ?? c.createdAt).toISOString(),
      name: c.name,
      phone: c.phone,
    });
    // CRM leads: stamped when promoted; some bulk promotions never stamped it, so fall back to creation time.
    queries.push(
      prisma.accountContact
        .findMany({
          where: { pipelineStage: "LEAD", deletedAt: null, ...after("promotedToLeadAt") } as Prisma.AccountContactWhereInput,
          orderBy: [{ promotedToLeadAt: "asc" }, { id: "asc" }],
          take,
          select: crmSelect,
        })
        .then((rows) => void lists.push(rows.map(crmItem))),
      prisma.accountContact
        .findMany({
          where: {
            AND: [{ pipelineStage: "LEAD", deletedAt: null, promotedToLeadAt: null }, after("createdAt")],
          } as Prisma.AccountContactWhereInput,
          orderBy: order,
          take,
          select: crmSelect,
        })
        .then((rows) => void lists.push(rows.map(crmItem))),
      prisma.metaLead
        .findMany({
          where: after("createdAt") as Prisma.MetaLeadWhereInput,
          orderBy: order,
          take,
          select: {
            id: true,
            createdAt: true,
            fullName: true,
            phone: true,
            city: true,
            sport: true,
            campaignName: true,
          },
        })
        .then((rows) =>
          lists.push(
            rows.map((l) => ({
              type: "lead" as const,
              source: "ad" as const,
              id: l.id,
              at: l.createdAt.toISOString(),
              name: l.fullName,
              phone: l.phone,
              city: l.city,
              sport: l.sport,
              campaignName: l.campaignName,
            })),
          ),
        )
        .then(() => undefined),
    );
  }

  await Promise.all(queries);
  const merged = mergeEvents(lists, input.limit);
  return {
    body: { events: merged.events, hasMore: merged.hasMore, nextCursor: merged.nextCursor, serverTime: new Date(now).toISOString() },
    recordIds: [],
  };
};
