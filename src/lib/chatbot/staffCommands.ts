// Execution layer for the WhatsApp staff-command set (spec §10) — all the
// DB reads/writes and reply-text formatting live here, deliberately kept
// separate from the actual outbound send (see handleStaffMessage at the
// bottom, and the webhook route that calls it). executeStaffCommand() never
// calls sendText() itself, so it's safe to unit-test directly against a
// dev database without ever touching the live Meta API.
import { prisma } from "@/lib/prisma";
import { transitionDeal, TransitionDealError } from "@/lib/funnel/transitionDeal";
import { parseNaturalDate, parseStaffCommand, type ParsedCommand } from "@/lib/chatbot/staffParse";

const APP_URL = process.env.APP_URL ?? "https://whatsapp-tool-marketing.vercel.app";
const PENDING_ACTION_TTL_MS = 10 * 60_000;

const HELP_TEXT = `Commands:
• new lead <name> <city> <phone>
• remind <when> <text> — e.g. "remind tomorrow 9am call the client"
• my day — today's reminders, overdue, stuck deals
• deal <code> — deal summary
• stage <code> <stage name> — move a deal (asks to confirm)
• quote <code> — link to the quotation builder
• help — this message`;

function formatDateTime(d: Date): string {
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function normalizeStageText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function fuzzyMatchStage(
  query: string,
  stages: { id: string; name: string; slug: string }[],
): { id: string; name: string; slug: string } | "ambiguous" | null {
  const q = normalizeStageText(query);
  const exact = stages.find((s) => normalizeStageText(s.name) === q || s.slug === q.replace(/ /g, "_"));
  if (exact) return exact;
  const contains = stages.filter((s) => normalizeStageText(s.name).includes(q) || q.includes(normalizeStageText(s.name)));
  if (contains.length === 1) return contains[0];
  if (contains.length > 1) return "ambiguous";
  return null;
}

// The one function with real logic — every command's DB effect and reply
// text. Returns the text to send; never sends it itself.
export async function executeStaffCommand(
  user: { id: string; name: string },
  parsed: ParsedCommand,
  now: Date = new Date(),
): Promise<string> {
  const pending = await prisma.pendingStaffAction.findUnique({ where: { userId: user.id } });

  if (parsed.type === "confirm_yes" || parsed.type === "confirm_no") {
    if (!pending || pending.expiresAt < now) {
      if (pending) await prisma.pendingStaffAction.delete({ where: { userId: user.id } }).catch(() => null);
      return "Nothing to confirm right now.";
    }
    await prisma.pendingStaffAction.delete({ where: { userId: user.id } });
    if (parsed.type === "confirm_no") return "Cancelled.";

    const payload = JSON.parse(pending.payload);
    if (pending.kind === "remind") {
      await prisma.reminder.create({
        data: { ownerUserId: user.id, message: payload.text, dueAt: new Date(payload.dueAt), channels: ["whatsapp", "in_app"] },
      });
      return `✅ Reminder set for ${formatDateTime(new Date(payload.dueAt))} — "${payload.text}"`;
    }
    if (pending.kind === "stage") {
      try {
        await transitionDeal({ dealId: payload.dealId, toStageId: payload.toStageId, userId: user.id });
        return `✅ ${payload.dealCode} moved to "${payload.stageName}".`;
      } catch (err) {
        const msg = err instanceof TransitionDealError ? err.message : "Could not change stage.";
        return `❌ ${msg}`;
      }
    }
    return "Nothing to confirm right now.";
  }

  // Any other command abandons a stale pending confirmation rather than
  // leaving the user stuck answering a question they've moved on from.
  if (pending) await prisma.pendingStaffAction.delete({ where: { userId: user.id } }).catch(() => null);

  if (parsed.type === "help") return HELP_TEXT;

  if (parsed.type === "new_lead") {
    const lead = await prisma.lead.create({
      data: { name: parsed.name, phone: parsed.phone, city: parsed.city, ownerUserId: user.id, status: "NEW" },
    });
    return `✅ Lead created: ${lead.name} (${lead.city}, ${lead.phone}).`;
  }

  if (parsed.type === "remind") {
    const dueAt = parseNaturalDate(parsed.whenRaw, now);
    if (!dueAt) return `Couldn't understand "${parsed.whenRaw}" as a date/time. Try "tomorrow 9am" or "in 2 hours".`;
    await prisma.pendingStaffAction.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        kind: "remind",
        payload: JSON.stringify({ dueAt: dueAt.toISOString(), text: parsed.text }),
        expiresAt: new Date(now.getTime() + PENDING_ACTION_TTL_MS),
      },
      update: {
        kind: "remind",
        payload: JSON.stringify({ dueAt: dueAt.toISOString(), text: parsed.text }),
        expiresAt: new Date(now.getTime() + PENDING_ACTION_TTL_MS),
      },
    });
    return `Set a reminder for ${formatDateTime(dueAt)} — "${parsed.text}"? Reply YES to confirm or NO to cancel.`;
  }

  if (parsed.type === "my_day") {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const reminders = await prisma.reminder.findMany({
      where: { ownerUserId: user.id, completedAt: null, dueAt: { lte: endOfToday } },
      orderBy: { dueAt: "asc" },
      select: { message: true, dueAt: true },
    });
    const overdue = reminders.filter((r) => r.dueAt < startOfToday);
    const dueToday = reminders.filter((r) => r.dueAt >= startOfToday);

    const DEFAULT_SLA_HOURS = 72;
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
    const openDeals = await prisma.deal.findMany({
      where: { deletedAt: null, outcome: null, ownerUserId: user.id },
      select: {
        code: true,
        enquiryAt: true,
        currentStage: { select: { slaHours: true } },
        stageHistory: { orderBy: { changedAt: "desc" }, take: 1, select: { changedAt: true } },
        activities: { orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true } },
      },
    });
    const stuck = openDeals.filter((d) => {
      const lastChange = d.stageHistory[0]?.changedAt ?? d.enquiryAt;
      const slaHours = d.currentStage.slaHours ?? DEFAULT_SLA_HOURS;
      return (now.getTime() - lastChange.getTime()) / 3_600_000 > slaHours;
    });
    const noRecentActivity = openDeals.filter((d) => {
      const last = d.activities[0]?.occurredAt;
      return !last || last < sevenDaysAgo;
    });

    const lines: string[] = [`☀️ My Day — ${user.name}`];
    lines.push("");
    lines.push(`📅 Due today (${dueToday.length}):`);
    lines.push(...(dueToday.length ? dueToday.map((r) => `  • ${formatDateTime(r.dueAt)} — ${r.message}`) : ["  none"]));
    if (overdue.length) {
      lines.push("");
      lines.push(`⏰ Overdue (${overdue.length}):`);
      lines.push(...overdue.slice(0, 5).map((r) => `  • ${formatDateTime(r.dueAt)} — ${r.message}`));
    }
    if (stuck.length) {
      lines.push("");
      lines.push(`⚠️ Stuck deals (${stuck.length}): ${stuck.slice(0, 5).map((d) => d.code).join(", ")}`);
    }
    if (noRecentActivity.length) {
      lines.push("");
      lines.push(`💤 No activity in 7+ days (${noRecentActivity.length}): ${noRecentActivity.slice(0, 5).map((d) => d.code).join(", ")}`);
    }
    return lines.join("\n");
  }

  if (parsed.type === "deal") {
    const deal = await prisma.deal.findUnique({
      where: { code: parsed.code },
      select: {
        id: true,
        code: true,
        title: true,
        account: { select: { name: true, city: true } },
        currentStage: { select: { name: true } },
        owner: { select: { name: true } },
        quotedValue: true,
        wonValue: true,
        estimatedValue: true,
      },
    });
    if (!deal) return `No deal found with code ${parsed.code}.`;
    const value = deal.wonValue ?? deal.quotedValue ?? deal.estimatedValue;
    return [
      `📁 ${deal.code} — ${deal.title}`,
      `Account: ${deal.account.name}${deal.account.city ? ` (${deal.account.city})` : ""}`,
      `Stage: ${deal.currentStage.name}`,
      `Owner: ${deal.owner?.name ?? "unassigned"}`,
      `Value: ${value ? "₹" + Number(value).toLocaleString("en-IN") : "—"}`,
      `${APP_URL}/deals/${deal.id}`,
    ].join("\n");
  }

  if (parsed.type === "stage") {
    const deal = await prisma.deal.findUnique({ where: { code: parsed.code }, select: { id: true, code: true, title: true } });
    if (!deal) return `No deal found with code ${parsed.code}.`;
    const stages = await prisma.funnelStage.findMany({ where: { isActive: true }, select: { id: true, name: true, slug: true } });
    const match = fuzzyMatchStage(parsed.stageQuery, stages);
    if (match === "ambiguous") return `"${parsed.stageQuery}" matches more than one stage — be more specific.`;
    if (!match) return `No stage matching "${parsed.stageQuery}". Send "help" to see the command list.`;
    await prisma.pendingStaffAction.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        kind: "stage",
        payload: JSON.stringify({ dealId: deal.id, dealCode: deal.code, toStageId: match.id, stageName: match.name }),
        expiresAt: new Date(now.getTime() + PENDING_ACTION_TTL_MS),
      },
      update: {
        kind: "stage",
        payload: JSON.stringify({ dealId: deal.id, dealCode: deal.code, toStageId: match.id, stageName: match.name }),
        expiresAt: new Date(now.getTime() + PENDING_ACTION_TTL_MS),
      },
    });
    return `Move ${deal.code} — "${deal.title}" to "${match.name}"? Reply YES to confirm or NO to cancel.`;
  }

  if (parsed.type === "quote") {
    const deal = await prisma.deal.findUnique({ where: { code: parsed.code }, select: { id: true, code: true } });
    if (!deal) return `No deal found with code ${parsed.code}.`;
    return `Open the quotation builder for ${deal.code}: ${APP_URL}/deals/${deal.id}`;
  }

  return `Sorry, I didn't understand that. Send "help" for the command list, or open the app: ${APP_URL}`;
}

// Webhook entry point — parses, executes, sends the reply, and mirrors it
// into the sender's own conversation thread so it shows up in the inbox
// like any other message.
export async function handleStaffMessage(args: {
  user: { id: string; name: string };
  conversationId: string;
  contactPhone: string;
  inboundBody: string;
}): Promise<void> {
  // Lazy-imported: sendText/writeOutboundMessage pull in axios + the full
  // chatbot dispatcher, which executeStaffCommand's pure DB logic doesn't
  // need — keeps that function (and its tests) free of network-client deps.
  const [{ sendText }, { writeOutboundMessage }] = await Promise.all([
    import("@/lib/whatsapp"),
    import("@/lib/chatbot/dispatch"),
  ]);
  const parsed = parseStaffCommand(args.inboundBody);
  const replyText = await executeStaffCommand(args.user, parsed);
  const sent = await sendText({ to: args.contactPhone, body: replyText }).catch((err) => {
    console.error("[staff-commands] sendText failed", err);
    return null;
  });
  await writeOutboundMessage(args.conversationId, { type: "text", body: replyText, waMessageId: sent?.waMessageId ?? null });
}
