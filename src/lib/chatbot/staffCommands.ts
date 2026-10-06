// Execution layer for the WhatsApp staff-command set (spec §10) — all the
// DB reads/writes and reply-text formatting live here, deliberately kept
// separate from the actual outbound send (see handleStaffMessage at the
// bottom, and the webhook route that calls it). executeStaffCommand() never
// calls sendText() itself, so it's safe to unit-test directly against a
// dev database without ever touching the live Meta API.
import { prisma } from "@/lib/prisma";
import { firstLeadStage } from "@/lib/crm/leadStages";
import { parseNaturalDate, parseStaffCommand, type ParsedCommand } from "@/lib/chatbot/staffParse";
import { getMyDay } from "@/lib/crm/myDay";

const APP_URL = process.env.APP_URL ?? "https://whatsapp-tool-marketing.vercel.app";
const PENDING_ACTION_TTL_MS = 10 * 60_000;

const HELP_TEXT = `Commands:
• new lead <name> <city> <phone>
• remind <when> <text> — e.g. "remind tomorrow 9am call the client"
• my day — today's reminders, overdue, leads to follow up
• deal <code> — deal summary
• quote <code> — new quotation for that deal's customer
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
        // In-app + push only — WhatsApp reminder delivery is switched off.
        data: { ownerUserId: user.id, message: payload.text, dueAt: new Date(payload.dueAt), channels: ["in_app"] },
      });
      return `✅ Reminder set for ${formatDateTime(new Date(payload.dueAt))} — "${payload.text}"`;
    }
    return "Nothing to confirm right now.";
  }

  // Any other command abandons a stale pending confirmation rather than
  // leaving the user stuck answering a question they've moved on from.
  if (pending) await prisma.pendingStaffAction.delete({ where: { userId: user.id } }).catch(() => null);

  if (parsed.type === "help") return HELP_TEXT;

  if (parsed.type === "new_lead") {
    // Was prisma.lead.create — the general Lead model (and its /crm/leads
    // page) was removed 2026-07-20 (see docs/DECISIONS.md): zero real usage
    // in production, and every row was identifiably test data. Repointed to
    // create a real Contact instead (auto-named account, same simplified
    // flow the New Contact form itself uses), so this command still lands
    // somewhere visible rather than silently writing to a dead table.
    // "new lead" puts them straight into Leads at the first sales stage.
    const account = await prisma.account.create({
      data: { name: parsed.name, city: parsed.city, ownerUserId: user.id },
    });
    const stage = await firstLeadStage();
    const contact = await prisma.accountContact.create({
      data: {
        accountId: account.id, name: parsed.name, phone: parsed.phone, isPrimary: true, createdByUserId: user.id,
        pipelineStage: "LEAD", promotedToLeadAt: now, leadStageId: stage?.id ?? null,
      },
    });
    return `✅ Lead created: ${contact.name} (${account.city}, ${contact.phone})${stage ? ` — ${stage.name}` : ""}.`;
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
    const { dueToday, overdue, untouchedLeads, nextActionsThisWeek, nextActionsThisWeekTotal } = await getMyDay(user.id);

    const lines: string[] = [`☀️ My Day — ${user.name}`];
    lines.push("");
    lines.push(`📅 Due today (${dueToday.length}):`);
    lines.push(...(dueToday.length ? dueToday.map((r) => `  • ${formatDateTime(new Date(r.dueAt))} — ${r.message}`) : ["  none"]));
    if (overdue.length) {
      lines.push("");
      lines.push(`⏰ Overdue (${overdue.length}):`);
      lines.push(...overdue.slice(0, 5).map((r) => `  • ${formatDateTime(new Date(r.dueAt))} — ${r.message}`));
    }
    if (untouchedLeads.length) {
      lines.push("");
      lines.push(`💤 Leads untouched 7+ days (${untouchedLeads.length}): ${untouchedLeads.slice(0, 5).map((l) => l.name).join(", ")}`);
    }
    if (nextActionsThisWeek.length) {
      lines.push("");
      lines.push(`🗓️ Next actions this week (${nextActionsThisWeekTotal}):`);
      lines.push(...nextActionsThisWeek.slice(0, 5).map((a) => `  • ${formatDateTime(new Date(a.dueAt))} — ${a.contactName}: ${a.text}`));
    }
    return lines.join("\n");
  }

  if (parsed.type === "deal") {
    const deal = await prisma.deal.findFirst({
      where: { code: parsed.code, deletedAt: null },
      select: {
        id: true,
        code: true,
        title: true,
        outcome: true,
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
      `Status: ${deal.outcome === "WON" ? "Confirmed" : deal.currentStage.name}`,
      `Owner: ${deal.owner?.name ?? "unassigned"}`,
      `Value: ${value ? "₹" + Number(value).toLocaleString("en-IN") : "—"}`,
      `${APP_URL}/deals/${deal.id}`,
    ].join("\n");
  }

  if (parsed.type === "stage") {
    // Deals are confirmed projects now — sales stages live on leads.
    return `Deals no longer move through stages. Move leads between stages in the app: ${APP_URL}/pipeline`;
  }

  if (parsed.type === "quote") {
    const deal = await prisma.deal.findFirst({
      where: { code: parsed.code, deletedAt: null },
      select: { id: true, code: true, primaryContact: { select: { id: true, name: true, phone: true, deletedAt: true } } },
    });
    if (!deal) return `No deal found with code ${parsed.code}.`;
    const c = deal.primaryContact && !deal.primaryContact.deletedAt ? deal.primaryContact : null;
    if (!c) return `${deal.code} has no customer contact — open it here: ${APP_URL}/deals/${deal.id}`;
    const params = new URLSearchParams({ contactId: c.id, customerName: c.name, ...(c.phone ? { phone: c.phone } : {}) });
    return `New quotation for ${c.name} (${deal.code}): ${APP_URL}/crm/quotations?${params.toString()}`;
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
