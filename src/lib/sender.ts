import { prisma } from "./prisma";
import { readSheet, colIndex } from "./sheets";
import { normalizePhone } from "./phone";
import { sendTemplate, describeMetaError } from "./whatsapp";
import { parseFields, contactPassesFilters, ContactFilterRule } from "./contacts";

const PACE_MS = parseInt(process.env.SENDER_PACE_MS || "120", 10); // ~8/sec
const CHUNK_SIZE = parseInt(process.env.SENDER_CHUNK_SIZE || "50", 10);

// Big broadcasts are sent in slices: one server run sends for SLICE_MS, then
// hands over to a fresh run (src/lib/broadcast-chain.ts). A Vercel run is
// capped at 60 s, so one long loop used to be cut off after ~150 people,
// leaving the broadcast stuck on "running".
export const SLICE_MS = 45_000;
// The sending lock outlives its slice a little, in case the last send overruns.
const LOCK_GRACE_MS = 30_000;
// How often a running slice re-checks for a Pause request.
const PAUSE_CHECK_MS = 5_000;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FilterRule = {
  column?: string;
  field?: string;
  condition: "equals" | "contains" | "starts_with" | "not_empty";
  value?: string;
};

function matchesFilter(cellValue: string, rule: FilterRule): boolean {
  const cell = String(cellValue ?? "").trim().toLowerCase();
  const val = String(rule.value ?? "").trim().toLowerCase();
  switch (rule.condition) {
    case "equals": return cell === val;
    case "contains": return cell.includes(val);
    case "starts_with": return cell.startsWith(val);
    case "not_empty": return cell.length > 0;
    default: return true;
  }
}

type Template = {
  name: string;
  language: string;
  body?: string | null;
  header?: string | null;
};

// Build the recipient list for a broadcast that has just been claimed for
// sending (its status is already "running"). Only the first time — a resumed
// broadcast keeps its list. No messages are sent here, so it's quick; it throws
// if the source (file / sheet) can't be read.
export async function prepareBroadcast(broadcastId: string): Promise<{ total: number }> {
  const broadcast = await prisma.broadcast.findUnique({ where: { id: broadcastId } });
  if (!broadcast) throw new Error("broadcast not found");

  const recipientCount = await prisma.broadcastRecipient.count({ where: { broadcastId } });
  if (recipientCount > 0) return { total: recipientCount };

  const mapping = JSON.parse(broadcast.variableMapping) as {
    phoneColumn: string;
    countryCodeColumn?: string | null;
    nameColumn?: string | null;
    variables: Record<string, string>;
    filterRules?: FilterRule[];
    selectedContactIds?: string[] | null;
    groupId?: string | null;
  };

  const optOuts = new Set(
    (await prisma.optOut.findMany({ select: { phoneE164: true } })).map((o) => o.phoneE164)
  );

  const insertData =
    broadcast.sourceType === "contacts"
      ? await materialiseFromContacts(broadcastId, mapping, optOuts)
      : await materialiseFromFileOrSheet(broadcastId, broadcast, mapping, optOuts);

  if (insertData.length > 0) {
    await prisma.broadcastRecipient.createMany({ data: insertData, skipDuplicates: true });
  }
  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { total: insertData.length },
    select: { id: true },
  });
  return { total: insertData.length };
}

// Send one slice of a "running" broadcast: queued recipients for up to
// `budgetMs`, then stop. Only one slice can hold a broadcast at a time (the
// Broadcast.sendingUntil lock), so two server runs never send the same
// broadcast. `more` = recipients are still queued and another slice should run.
export async function runSlice(
  broadcastId: string,
  budgetMs: number = SLICE_MS
): Promise<{ ran: boolean; more: boolean }> {
  const startedAt = Date.now();
  const claimed = await prisma.broadcast.updateMany({
    where: {
      id: broadcastId,
      status: "running",
      OR: [{ sendingUntil: null }, { sendingUntil: { lt: new Date(startedAt) } }],
    },
    data: { sendingUntil: new Date(startedAt + budgetMs + LOCK_GRACE_MS) },
  });
  // Paused / finished, or another run is sending it right now.
  if (claimed.count === 0) return { ran: false, more: false };

  try {
    // A run that died mid-send leaves that recipient marked "sending". Whether
    // WhatsApp got the message is unknown, so it's marked failed rather than
    // risking sending it twice.
    await prisma.broadcastRecipient.updateMany({
      where: { broadcastId, status: "sending" },
      data: {
        status: "failed",
        errorMessage: "Sending was interrupted — this person may not have received the message.",
      },
    });

    // Not the whole row: fileData / variableMapping are big and not needed to send.
    const broadcast = await prisma.broadcast.findUnique({
      where: { id: broadcastId },
      select: { createdByUserId: true, template: true },
    });
    if (!broadcast) return { ran: true, more: false };

    const outcome = await dispatchQueued(
      broadcastId,
      broadcast.template,
      { templateId: broadcast.template.id, senderUserId: broadcast.createdByUserId },
      startedAt + budgetMs
    );
    return { ran: true, more: outcome === "more" };
  } finally {
    await prisma.broadcast
      .updateMany({ where: { id: broadcastId }, data: { sendingUntil: null } })
      .catch(() => null);
  }
}

// ─── Source: Saved Contacts ─────────────────────────────────────────────────
async function materialiseFromContacts(
  broadcastId: string,
  mapping: {
    variables: Record<string, string>;
    filterRules?: FilterRule[];
    selectedContactIds?: string[] | null;
    groupId?: string | null;
  },
  optOuts: Set<string>
) {
  const rules = (mapping.filterRules ?? [])
    .map((r) => ({ field: r.field ?? r.column ?? "", condition: r.condition, value: r.value }))
    .filter((r) => r.field.trim()) as ContactFilterRule[];

  const groupId = mapping.groupId || null;
  const selectedIds = mapping.selectedContactIds?.length
    ? mapping.selectedContactIds
    : null;

  // Group mode: the group's members as of now (people added after the
  // broadcast was scheduled are included). A group that was deleted or emptied
  // means nobody — it must never fall through to the whole contact pool.
  // Pick mode: query only the picked IDs, skip filter rules. Consent +
  // opt-out gates still apply (a hand-picked contact who's opted out
  // still gets skipped).
  const contacts = groupId
    ? await prisma.contact.findMany({ where: { groups: { some: { groupId } } } })
    : selectedIds
      ? await prisma.contact.findMany({ where: { id: { in: selectedIds } } })
      : await prisma.contact.findMany();
  const insertData: Array<{ broadcastId: string; phoneE164: string; name: string | null; variables: string }> = [];

  for (const c of contacts) {
    const fields = parseFields(c.fields);
    if (!groupId && !selectedIds && !contactPassesFilters({ name: c.name, fields }, rules)) continue;
    if (!c.allowCampaign) continue; // consent gate — never message non-consenting contacts
    if (optOuts.has(c.phone)) continue;
    const variables: Record<string, string> = {};
    for (const [k, fieldName] of Object.entries(mapping.variables)) {
      variables[k] = fieldName.toLowerCase() === "name" ? c.name ?? "" : fields[fieldName] ?? "";
    }
    insertData.push({
      broadcastId,
      phoneE164: c.phone,
      name: c.name,
      variables: JSON.stringify(variables),
    });
  }
  return insertData;
}

// ─── Source: File upload / Google Sheet ─────────────────────────────────────
async function materialiseFromFileOrSheet(
  broadcastId: string,
  broadcast: { fileData: string | null; sheetId: string | null; sheetRange: string | null },
  mapping: {
    phoneColumn: string;
    countryCodeColumn?: string | null;
    nameColumn?: string | null;
    variables: Record<string, string>;
    filterRules?: FilterRule[];
  },
  optOuts: Set<string>
) {
  let headers: string[] = [];
  let dataRows: string[][];

  if (broadcast.fileData) {
    const parsed = JSON.parse(broadcast.fileData) as string[][];
    headers = parsed[0] || [];
    dataRows = parsed.slice(1);
  } else if (broadcast.sheetId && broadcast.sheetRange) {
    dataRows = await readSheet({ sheetUrlOrId: broadcast.sheetId, range: broadcast.sheetRange });
  } else {
    throw new Error("No data source configured for broadcast");
  }

  const getColumnIndex = (colKey: string): number => {
    if (!colKey) return -1;
    const byHeader = headers.findIndex(
      (h) => String(h).trim().toLowerCase() === colKey.trim().toLowerCase()
    );
    if (byHeader >= 0) return byHeader;
    if (/^\d+$/.test(colKey)) return parseInt(colKey, 10);
    try { return colIndex(colKey); } catch { return -1; }
  };

  const phoneIdx = getColumnIndex(mapping.phoneColumn);
  const countryCodeIdx = mapping.countryCodeColumn ? getColumnIndex(mapping.countryCodeColumn) : -1;
  const nameIdx = mapping.nameColumn ? getColumnIndex(mapping.nameColumn) : -1;

  const activeFilters = (mapping.filterRules ?? []).filter((r) => (r.column ?? "").trim());
  const filterIndices = activeFilters.map((r) => ({ rule: r, idx: getColumnIndex(r.column ?? "") }));

  const insertData: Array<{ broadcastId: string; phoneE164: string; name: string | null; variables: string }> = [];

  for (const row of dataRows) {
    if (filterIndices.length > 0) {
      const passes = filterIndices.every(({ rule, idx }) => {
        if (idx < 0) return false;
        return matchesFilter(String(row[idx] ?? ""), rule);
      });
      if (!passes) continue;
    }

    let rawPhone = String(row[phoneIdx] ?? "").trim();
    if (countryCodeIdx >= 0) {
      const cc = String(row[countryCodeIdx] ?? "").replace(/\D/g, "");
      rawPhone = cc + rawPhone.replace(/\D/g, "");
    }

    const phone = normalizePhone(rawPhone);
    if (!phone || optOuts.has(phone)) continue;

    const variables: Record<string, string> = {};
    for (const [k, col] of Object.entries(mapping.variables)) {
      variables[k] = String(row[getColumnIndex(col)] ?? "");
    }
    insertData.push({
      broadcastId,
      phoneE164: phone,
      name: nameIdx >= 0 ? String(row[nameIdx] ?? "") : null,
      variables: JSON.stringify(variables),
    });
  }
  return insertData;
}

// Render the template body with this recipient's variables ({{1}}, {{2}}, …)
// for storage in the Message.body — gives the inbox a real chat-style preview.
function renderTemplateBody(templateBody: string, rVars: Record<string, string>): string {
  return templateBody.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => rVars[String(n)] ?? "");
}

// ─── Dispatch: process queued recipients in throttled chunks ────────────────
// Stops at `deadline` (the slice's time budget) with the rest still queued →
// "more"; "paused" when a pause was requested; "done" once nobody is queued.
async function dispatchQueued(
  broadcastId: string,
  template: Template,
  ctx: { templateId: string; senderUserId: string },
  deadline: number
): Promise<"done" | "more" | "paused"> {
  while (true) {
    // Honor pause requests between chunks. The /pause endpoint sets
    // pauseRequestedAt; here we observe it and write pausedAt + flip status.
    const status = await prisma.broadcast.findUnique({
      where: { id: broadcastId },
      select: { pauseRequestedAt: true },
    });
    if (status?.pauseRequestedAt) {
      await prisma.broadcast.update({
        where: { id: broadcastId },
        data: { status: "paused", pausedAt: new Date() },
        select: { id: true },
      });
      return "paused";
    }
    if (Date.now() >= deadline) return "more";

    const batch = await prisma.broadcastRecipient.findMany({
      where: { broadcastId, status: "queued" },
      take: CHUNK_SIZE,
    });
    if (batch.length === 0) break;

    const templateHasVars = /\{\{\s*\d+\s*\}\}/.test(template.body ?? "");

    // Build the static header component once per dispatch (same media for all
    // recipients in this broadcast). Only media headers need a parameter at
    // send time — TEXT headers are static and need no parameter unless they
    // contain a {{1}} placeholder (not supported by this UI yet).
    let headerComponent: any | null = null;
    if (template.header) {
      try {
        const h = JSON.parse(template.header) as
          | { format: "TEXT"; text: string }
          | { format: "IMAGE" | "VIDEO" | "DOCUMENT"; url: string; filename?: string };
        if (h.format === "IMAGE") {
          headerComponent = { type: "header", parameters: [{ type: "image", image: { link: h.url } }] };
        } else if (h.format === "VIDEO") {
          headerComponent = { type: "header", parameters: [{ type: "video", video: { link: h.url } }] };
        } else if (h.format === "DOCUMENT") {
          headerComponent = {
            type: "header",
            parameters: [
              { type: "document", document: { link: h.url, filename: h.filename ?? "document.pdf" } },
            ],
          };
        }
      } catch {
        /* fall through — no header parameter */
      }
    }

    let pauseCheckedAt = Date.now();
    for (const r of batch) {
      if (Date.now() >= deadline) break; // out of time — the rest stay queued for the next slice
      // Notice a Pause within a few seconds, not only between chunks of 50.
      if (Date.now() - pauseCheckedAt > PAUSE_CHECK_MS) {
        pauseCheckedAt = Date.now();
        const p = await prisma.broadcast.findUnique({ where: { id: broadcastId }, select: { pauseRequestedAt: true } });
        if (p?.pauseRequestedAt) break; // the loop's next pass marks it paused
      }
      // Mark first: if this run dies mid-send, the next slice marks it failed
      // instead of sending it a second time (see runSlice).
      const mine = await prisma.broadcastRecipient.updateMany({
        where: { id: r.id, status: "queued" },
        data: { status: "sending" },
      });
      if (mine.count === 0) continue;
      try {
        const rVars = JSON.parse(r.variables) as Record<string, string>;
        // Only include body component if the template body actually has {{N}} placeholders.
        // The UI hardcodes a {{1}} mapping even for templates with no variables;
        // sending parameters to a no-variable template causes Meta error #132000.
        const paramEntries = templateHasVars
          ? Object.entries(rVars).sort(([a], [b]) => Number(a) - Number(b))
          : [];
        const components: any[] = [];
        if (headerComponent) components.push(headerComponent);
        if (paramEntries.length > 0) {
          components.push({
            type: "body" as const,
            parameters: paramEntries.map(([, value]) => ({ type: "text" as const, text: value })),
          });
        }
        const result = await sendTemplate({
          to: r.phoneE164,
          templateName: template.name,
          language: template.language,
          components,
        });
        await prisma.broadcastRecipient.update({
          where: { id: r.id },
          data: { status: "sent", waMessageId: result.waMessageId, sentAt: new Date() },
        });

        // Surface this send in the inbox as a normal outbound message so the
        // conversation reads like a chat — broadcast send, then any reply from
        // the recipient lands in the same thread.
        const renderedBody = renderTemplateBody(template.body ?? "", rVars);
        const convo = await prisma.conversation.upsert({
          where: { contactPhone: r.phoneE164 },
          create: {
            contactPhone: r.phoneE164,
            contactName: r.name,
            originBroadcastId: broadcastId,
            lastOutboundAt: new Date(),
          },
          update: {
            contactName: r.name ?? undefined,
            lastOutboundAt: new Date(),
          },
        });
        await prisma.message
          .create({
            data: {
              conversationId: convo.id,
              direction: "outbound",
              type: "template",
              body: renderedBody,
              waMessageId: result.waMessageId,
              templateId: ctx.templateId,
              status: "sent",
              sentByUserId: ctx.senderUserId,
            },
          })
          .catch(() => {
            /* If waMessageId unique collides (retry edge case), ignore. */
          });
      } catch (err) {
        const e = describeMetaError(err);
        await prisma.broadcastRecipient.update({
          where: { id: r.id },
          data: { status: "failed", errorCode: e.code, errorMessage: e.message },
        });
      }
      await sleep(PACE_MS);
    }

    // Recompute counters after each chunk
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

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: "completed", completedAt: new Date() },
    select: { id: true },
  });
  return "done";
}
