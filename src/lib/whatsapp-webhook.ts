import { prisma } from "@/lib/prisma";
import { isOptOutMessage } from "@/lib/webhook";
import { fetchInboundMedia } from "@/lib/whatsapp";
import { uploadToBlob } from "@/lib/media";
import { dispatchAutoReply } from "@/lib/auto-replies/dispatch";
import { dispatchAfterHoursGate } from "@/lib/auto-replies/after-hours-gate";
import { dispatchChatbot } from "@/lib/chatbot/dispatch";
import { handleStaffMessage } from "@/lib/chatbot/staffCommands";
import { handleLeadgen } from "@/lib/meta-ads/leads";
import { notifyInboundMessage } from "@/lib/push";

// The WhatsApp webhook (src/app/api/webhooks/whatsapp/route.ts) answers Meta
// fast: it only SAVES the inbound messages before replying 200 (so Meta
// retries if that fails), and everything else — media, replies, status
// updates, templates, leads — runs after the response via runDeferred().

// A big broadcast produces thousands of sent/delivered/read events, and
// recounting every recipient of the broadcast on each one was the heaviest
// part of this webhook. Recount at most once per RECOUNT_EVERY_MS per
// broadcast (per server instance). The sender recounts after every chunk and
// when it finishes, and the Broadcasts page re-syncs counts when opened, so the
// numbers never stay behind for long.
const RECOUNT_EVERY_MS = 10_000;
const lastRecountAt = new Map<string, number>();

// Don't let one slow Meta/Blob download hold the whole deferred run (the
// function is capped at 60 s).
const MEDIA_TIMEOUT_MS = 25_000;

// ─── Retry / safety helpers ─────────────────────────────────────────────────

// Neon closes idle connections; the first query after that can fail with a
// connection error that works on a retry.
function isTransientDbError(err: unknown): boolean {
  const e = err as { code?: string; name?: string; message?: string } | null;
  if (e?.name === "PrismaClientInitializationError") return true;
  // P1001 unreachable, P1002 timed out, P1008 op timed out, P1017 server closed
  // connection, P2024 pool timeout, P2034 write conflict / deadlock.
  if (e?.code && ["P1001", "P1002", "P1008", "P1017", "P2024", "P2034"].includes(e.code)) return true;
  return /Can't reach database|closed the connection|Connection (reset|closed|terminated|refused)|ECONNRESET|ETIMEDOUT|socket hang up|kind: Closed|Timed out fetching a new connection/i.test(
    String(e?.message ?? "")
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Up to 3 attempts (1 + 2 retries), only for transient connection errors.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 2 || !isTransientDbError(err)) throw err;
      await sleep(200 * (attempt + 1));
    }
  }
}

// Runs one webhook item; never throws. `retry: false` is for work that has
// side effects (sending replies) — a half-run flow must not run twice.
async function safe<T>(
  kind: string,
  id: string,
  fn: () => Promise<T>,
  opts: { retry?: boolean } = {}
): Promise<T | undefined> {
  try {
    return opts.retry === false ? await fn() : await withRetry(fn);
  } catch (err) {
    console.error(`[webhook] ${kind} failed ${id}`, err);
    return undefined;
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // If the timeout wins, the late result/rejection must not become unhandled.
  work.catch(() => null);
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Payload → work items ───────────────────────────────────────────────────

export type WebhookPlan = {
  inbound: { msg: any; profileName?: string }[];
  statuses: any[];
  templateUpdates: any[];
  leadgens: any[];
};

export function planWebhook(payload: any): WebhookPlan {
  const plan: WebhookPlan = { inbound: [], statuses: [], templateUpdates: [], leadgens: [] };
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value ?? {};
      const field = change?.field ?? "";

      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        plan.statuses.push(status);
      }
      for (const msg of Array.isArray(value.messages) ? value.messages : []) {
        const contact = (Array.isArray(value.contacts) ? value.contacts : []).find(
          (c: any) => c?.wa_id === msg?.from
        );
        plan.inbound.push({ msg, profileName: contact?.profile?.name });
      }
      // Template approval status callbacks
      if (field === "message_template_status_update") plan.templateUpdates.push(value);
      // Lead-gen Instant-Form submissions (Meta Marketing API)
      if (field === "leadgen") plan.leadgens.push(value);
    }
  }
  return plan;
}

// ─── Phase 1 (before replying): save inbound messages, no media download ────

export type SavedInbound = {
  messageId: string;
  conversationId: string;
  assignedToUserId: string | null;
  contactName: string | null;
  from: string;
  waMessageId: string;
  type: string;
  storedType: "text" | "image" | "document" | "video" | "audio";
  body: string | null;
  interactiveReplyId: string | null;
  media: { id: string; claimedFileName?: string } | null;
};

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"];

// Throws if the database fails, so the route answers 500 and Meta retries.
export async function saveInboundMessages(items: WebhookPlan["inbound"]): Promise<SavedInbound[]> {
  const saved: SavedInbound[] = [];
  for (const item of items) {
    const s = await saveInbound(item.msg, item.profileName);
    if (s) saved.push(s);
  }
  return saved;
}

async function saveInbound(msg: any, profileName?: string): Promise<SavedInbound | null> {
  const from = msg?.from as string;
  const waMessageId = msg?.id as string;
  const type = msg?.type as string;
  if (!from || !waMessageId) return null;

  // Interactive replies (button tap or list pick) come through as
  // type=interactive with the picked option's id + title nested inside
  // msg.interactive.{button_reply|list_reply}. We surface the id
  // separately so the chatbot flow dispatcher can route on it, and mirror
  // the human-readable title as the message body for the inbox view.
  let interactiveReplyId: string | null = null;
  if (type === "interactive") {
    const br = msg.interactive?.button_reply;
    const lr = msg.interactive?.list_reply;
    if (br) interactiveReplyId = br.id ?? null;
    else if (lr) interactiveReplyId = lr.id ?? null;
  }
  const body: string | undefined =
    type === "text"
      ? msg.text?.body
      : type === "button"
      ? msg.button?.text
      : type === "interactive"
      ? (msg.interactive?.button_reply?.title ??
        msg.interactive?.list_reply?.title ??
        "")
      : (msg[type]?.caption ?? "");

  // Idempotency: skip if already stored
  const existing = await withRetry(() =>
    prisma.message.findUnique({ where: { waMessageId }, select: { id: true } })
  );
  if (existing) return null;

  // Upsert conversation. unreadCount is bumped only after the message row is
  // created, so a duplicate delivery never counts twice.
  const convo = await withRetry(() =>
    prisma.conversation.upsert({
      where: { contactPhone: from },
      create: {
        contactPhone: from,
        contactName: profileName ?? null,
        lastInboundAt: new Date(),
        unreadCount: 0,
      },
      update: {
        contactName: profileName ?? undefined,
        lastInboundAt: new Date(),
      },
      select: { id: true, assignedToUserId: true, contactName: true },
    })
  );

  // Map sticker → image so the UI's image preview path handles it.
  const normalizedType = type === "sticker" ? "image" : type;
  // Map normalizedType to one of our supported enum values.
  const storedType = (
    ["text", "image", "document", "video", "audio"].includes(normalizedType) ? normalizedType : "text"
  ) as SavedInbound["storedType"];

  let message: { id: string };
  try {
    message = await withRetry(() =>
      prisma.message.create({
        data: {
          conversationId: convo.id,
          direction: "inbound",
          type: storedType,
          body: body ?? null,
          waMessageId,
          status: "delivered",
        },
        select: { id: true },
      })
    );
  } catch (err) {
    // waMessageId is unique: another delivery of the same message won the race.
    if ((err as { code?: string })?.code === "P2002") return null;
    throw err;
  }

  // The message is saved; a failed counter bump must not make Meta resend it.
  await withRetry(() =>
    prisma.conversation.update({
      where: { id: convo.id },
      data: { unreadCount: { increment: 1 } },
      select: { id: true },
    })
  ).catch((err) => console.error(`[webhook] unread bump failed ${waMessageId}`, err));

  // For each media type Meta sends the media_id in the type-named object
  // (e.g. msg.image.id). The download happens later, in the deferred phase.
  const mediaId = MEDIA_TYPES.includes(type) ? msg[type]?.id : null;

  return {
    messageId: message.id,
    conversationId: convo.id,
    assignedToUserId: convo.assignedToUserId,
    contactName: convo.contactName,
    from,
    waMessageId,
    type,
    storedType,
    body: body ?? null,
    interactiveReplyId,
    media: mediaId ? { id: mediaId, claimedFileName: msg[type]?.filename } : null,
  };
}

// ─── Phase 2 (after replying) ───────────────────────────────────────────────

export async function runDeferred(plan: WebhookPlan, saved: SavedInbound[], startedAt: number): Promise<void> {
  const jobs: Promise<unknown>[] = [];

  // Media downloads all start at once and run alongside the replies.
  for (const s of saved) {
    jobs.push(safe("media", s.waMessageId, () => attachMedia(s), { retry: false }));
  }

  // Replies go one message at a time, in order.
  jobs.push(
    (async () => {
      for (const s of saved) {
        await safe("inbound", s.waMessageId, () => handleInboundReplies(s), { retry: false });
      }
    })()
  );

  if (plan.statuses.length > 0) {
    jobs.push(safe("statuses", String(plan.statuses.length), () => applyStatuses(plan.statuses), { retry: false }));
  }
  for (const value of plan.templateUpdates) {
    jobs.push(safe("template status", String(value?.message_template_id ?? "-"), () => handleTemplateStatusUpdate(value)));
  }
  for (const value of plan.leadgens) {
    jobs.push(safe("leadgen", String(value?.leadgen_id ?? "-"), () => handleLeadgen(value), { retry: false }));
  }

  await Promise.all(jobs);
  console.log(`[webhook] done in ${Date.now() - startedAt} ms`);
}

// Download the media, push it to Vercel Blob and fill in the saved message row,
// so the inbox can render the preview without round-tripping to Meta on every
// load. On failure the message simply stays without media (the caption still
// shows) — same as before.
async function attachMedia(s: SavedInbound): Promise<void> {
  if (!s.media) return;
  const { id: mediaId, claimedFileName } = s.media;
  const { fetched, uploaded } = await withTimeout(
    (async () => {
      const f = await fetchInboundMedia(mediaId);
      const up = await uploadToBlob({
        bytes: f.bytes,
        fileName: claimedFileName ?? f.fileName,
        mimeType: f.mimeType,
        folder: "inbound",
      });
      return { fetched: f, uploaded: up };
    })(),
    MEDIA_TIMEOUT_MS,
    "inbound media download"
  );
  await withRetry(() =>
    prisma.message.update({
      where: { id: s.messageId },
      data: {
        mediaUrl: uploaded.url,
        mediaMimeType: fetched.mimeType,
        mediaFileName: claimedFileName ?? fetched.fileName,
        mediaSize: fetched.bytes.length,
      },
      select: { id: true },
    })
  );
}

async function handleInboundReplies(s: SavedInbound): Promise<void> {
  // Push notification for the inbound message. Runs alongside the replies.
  const push = notifyInboundMessage(
    { id: s.conversationId, assignedToUserId: s.assignedToUserId, contactName: s.contactName, contactPhone: s.from },
    s.body,
    s.storedType
  ).catch(() => null);
  try {
    await replyToInbound(s);
  } finally {
    await push;
  }
}

async function replyToInbound(s: SavedInbound): Promise<void> {
  const { from, type, body, conversationId, interactiveReplyId } = s;

  // Opt-out detection
  if (type === "text" && isOptOutMessage(body ?? "")) {
    await withRetry(() =>
      prisma.optOut.upsert({
        where: { phoneE164: from },
        create: { phoneE164: from, reason: "stop_reply" },
        update: { optedOutAt: new Date(), reason: "stop_reply" },
      })
    );
    // Don't auto-reply on the same message that opts them out — that
    // would be perverse. Return early.
    return;
  }

  // Rate limit — spec §14. The real gate against forged traffic is the HMAC
  // signature check at the top of POST; this is defense-in-depth against a
  // single contact flooding us (broken client, or a bug causing a reply
  // loop). Reuses the Message rows we already store — no new table/service.
  // Meta's own webhook-delivery traffic isn't itself the threat here (it's
  // just carrying whatever a real WhatsApp user's client sent), so limiting
  // per contactPhone is what actually matters, not per-request-source.
  const recentInboundCount = await withRetry(() =>
    prisma.message.count({
      where: { conversationId, direction: "inbound", createdAt: { gte: new Date(Date.now() - 60_000) } },
    })
  );
  if (recentInboundCount > 20) {
    console.warn(`[webhook] rate limit: ${from} sent ${recentInboundCount} messages in the last 60s — dropping further processing`);
    return;
  }

  // Staff command check — spec §10: identify the sender by User.phone
  // *before* anything customer-facing runs. Known staff numbers get routed
  // to the bot-command handler exclusively (no after-hours gate, no
  // customer flow, no auto-replies); unknown numbers fall through to the
  // existing behavior completely unchanged. Never executes a command for a
  // number that isn't a known, active staff user.
  if (type === "text" && body) {
    const staffUser = await withRetry(() =>
      prisma.user.findFirst({ where: { phone: from, isActive: true, deletedAt: null }, select: { id: true, name: true } })
    ).catch(() => null);
    if (staffUser) {
      await handleStaffMessage({
        user: staffUser,
        conversationId,
        contactPhone: from,
        inboundBody: body,
      }).catch((err) => console.error("[webhook] staff command handling threw", err));
      return;
    }
  }

  // After-hours gate — outside 9am-8pm IST, on a fresh conversation,
  // send a polite acknowledgement and short-circuit so we don't start
  // a chatbot menu at 3am. Mid-flow taps and mid-conversation free text
  // pass straight through (the gate returns false in those cases).
  const gated = await dispatchAfterHoursGate({
    conversationId,
    contactPhone: from,
    hasInteractiveReply: !!interactiveReplyId,
  }).catch((err) => {
    console.error("[webhook] after-hours gate threw", err);
    return false;
  });
  if (gated) return;

  // Chatbot flow first — if a flow is active OR the inbound looks like
  // a flow-starting greeting, the flow engine takes over exclusively.
  // Only if the flow decides "not my message" do we fall through to the
  // legacy auto-reply rules. Silent-fail so a bug can't crash the
  // webhook contract with Meta.
  const flowHandled = await dispatchChatbot({
    conversationId,
    contactPhone: from,
    inboundBody: body ?? "",
    interactiveReplyId,
  }).catch((err) => {
    console.error("[webhook] chatbot dispatch threw", err);
    return false;
  });

  // Legacy auto-reply dispatcher (L1 location, C1 catalogue, S1 sport,
  // G1 greeting). Skipped when the chatbot flow handled the message
  // so we don't double-reply. After-hours has its own gate above.
  if (!flowHandled && type === "text" && body) {
    await dispatchAutoReply({
      conversationId,
      contactPhone: from,
      inboundBody: body,
    }).catch((err) => console.error("[webhook] auto-reply dispatch threw", err));
  }
}

// ─── Status updates (sent / delivered / read / failed) ──────────────────────

// Only ever move forward: sent → delivered → read. A late "delivered" must
// never overwrite "read". Each target below lists the statuses it must NOT
// overwrite (itself and anything further along); anything else — queued,
// sending, failed — may move up. "failed" is applied as before, unconditionally.
const FORWARD = ["sent", "delivered", "read"] as const;
type Forward = (typeof FORWARD)[number];
const NOT_OVERWRITING: Record<Forward, string[]> = {
  sent: ["sent", "delivered", "read"],
  delivered: ["delivered", "read"],
  read: ["read"],
};

type FailedGroup = { ids: Set<string>; code?: string; message?: string; hasError: boolean };

// A whole payload at once: a handful of grouped updates instead of 2-3
// queries per status, then one recount per touched broadcast.
async function applyStatuses(statuses: any[]): Promise<void> {
  const forward: Record<Forward, Set<string>> = { sent: new Set(), delivered: new Set(), read: new Set() };
  const failed = new Map<string, FailedGroup>();
  const all = new Set<string>();

  for (const st of statuses) {
    const id = st?.id;
    const status = st?.status as string | undefined;
    if (typeof id !== "string" || !id) continue;
    if (status === "sent" || status === "delivered" || status === "read") {
      forward[status].add(id);
      all.add(id);
    } else if (status === "failed") {
      const err = st.errors?.[0];
      const code = err ? String(err.code ?? "") : undefined;
      const message = err ? err.message ?? "" : undefined;
      const key = err ? `${code}|${message}` : "";
      if (!failed.has(key)) failed.set(key, { ids: new Set(), code, message, hasError: !!err });
      failed.get(key)!.ids.add(id);
      all.add(id);
    }
  }
  if (all.size === 0) return;
  const allIds = Array.from(all);
  const now = new Date();
  const stamp = (s: Forward) => (s === "sent" ? { sentAt: now } : s === "delivered" ? { deliveredAt: now } : { readAt: now });

  // Message rows (the Inbox thread) and broadcast recipients are independent.
  const [, touched] = await Promise.all([
    safe("status message", String(allIds.length), async () => {
      for (const s of FORWARD) {
        if (forward[s].size === 0) continue;
        await prisma.message.updateMany({
          where: { waMessageId: { in: Array.from(forward[s]) }, status: { notIn: NOT_OVERWRITING[s] } },
          data: { status: s },
        });
      }
      for (const g of failed.values()) {
        await prisma.message.updateMany({
          where: { waMessageId: { in: Array.from(g.ids) } },
          data: { status: "failed", ...(g.hasError && { errorCode: g.code, errorMessage: g.message }) },
        });
      }
    }),
    safe("status recipient", String(allIds.length), async () => {
      const found = await prisma.broadcastRecipient.findMany({
        where: { waMessageId: { in: allIds } },
        select: { broadcastId: true },
        distinct: ["broadcastId"],
      });
      if (found.length === 0) return [] as string[];
      for (const s of FORWARD) {
        if (forward[s].size === 0) continue;
        await prisma.broadcastRecipient.updateMany({
          where: { waMessageId: { in: Array.from(forward[s]) }, status: { notIn: NOT_OVERWRITING[s] } },
          data: { status: s, ...stamp(s) },
        });
        // A late receipt (e.g. "delivered" after "read") doesn't move the
        // status back, but still fills its missing timestamp for analytics.
        const missing = s === "sent" ? { sentAt: null } : s === "delivered" ? { deliveredAt: null } : { readAt: null };
        await prisma.broadcastRecipient.updateMany({
          where: { waMessageId: { in: Array.from(forward[s]) }, ...missing },
          data: stamp(s),
        });
      }
      for (const g of failed.values()) {
        await prisma.broadcastRecipient.updateMany({
          where: { waMessageId: { in: Array.from(g.ids) } },
          data: { status: "failed", ...(g.hasError && { errorCode: g.code, errorMessage: g.message }) },
        });
      }
      return found.map((f) => f.broadcastId);
    }),
  ]);

  // Recompute broadcast counters, once per touched broadcast (throttled — see
  // RECOUNT_EVERY_MS).
  await Promise.all(
    (touched ?? []).map((broadcastId) => {
      if (Date.now() - (lastRecountAt.get(broadcastId) ?? 0) < RECOUNT_EVERY_MS) return null;
      lastRecountAt.set(broadcastId, Date.now());
      return safe("recount", broadcastId, () => recountBroadcast(broadcastId));
    })
  );
}

async function recountBroadcast(broadcastId: string): Promise<void> {
  const groups = await prisma.broadcastRecipient.groupBy({
    by: ["status"],
    where: { broadcastId },
    _count: { _all: true },
  });
  const counters: Record<string, number> = {};
  for (const g of groups) counters[g.status] = g._count._all;
  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: {
      sent: counters.sent ?? 0,
      delivered: counters.delivered ?? 0,
      read: counters.read ?? 0,
      failed: counters.failed ?? 0,
    },
    select: { id: true },
  });
}

// ─── Template approval status ───────────────────────────────────────────────

async function handleTemplateStatusUpdate(value: any): Promise<void> {
  const metaTemplateId = value.message_template_id as string | undefined;
  const event = (value.event ?? "").toString().toLowerCase();
  if (!metaTemplateId) return;

  let status: "approved" | "rejected" | "paused" | "submitted" | null = null;
  if (event.includes("approved")) status = "approved";
  else if (event.includes("rejected")) status = "rejected";
  else if (event.includes("paused")) status = "paused";
  if (!status) return;

  await prisma.template.updateMany({
    where: { metaTemplateId },
    data: {
      status,
      rejectionReason: status === "rejected" ? value.reason ?? null : null,
    },
  });
}
