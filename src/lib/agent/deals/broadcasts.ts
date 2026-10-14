/**
 * The AI's campaign tools. The rule behind all of them: no bulk messaging outside
 * approved campaign limits.
 *
 *   draft_broadcast       ALLOWED   creates a DRAFT only; nothing is sent
 *   get_broadcast_status  ALLOWED   counters of the AI's own broadcasts
 *   pause_broadcast       ALLOWED   a stop button; it can only stop things
 *   launch_broadcast      APPROVAL  a person approves this exact campaign
 *   schedule_broadcast    APPROVAL  likewise
 *
 * A campaign is saved contacts only (never an uploaded file or a sheet). The
 * recipient list is frozen into the draft at that moment, with opted-out
 * contacts and contacts without campaign consent already removed, so a group
 * that grows later cannot enlarge an approved campaign. Launch and schedule
 * check the caps and the opt-outs again when they are carried out. Sending
 * itself is the existing flow (src/lib/broadcasts/control.ts -> prepareBroadcast).
 */
import type { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { createBroadcastRecord } from "@/lib/broadcasts/create";
import { requestBroadcastPause, startBroadcast } from "@/lib/broadcasts/control";
import { scheduleWindowError } from "@/lib/broadcasts/schedule";
import type { AgentContext } from "../context";
import { AgentHttpError } from "../errors";
import { refusal } from "../messaging/access";
import { requireId, toIso } from "../read/shared";
import { TOOLS } from "../registry/deals";
import type {
  draftBroadcastBodySchema,
  launchBroadcastInputSchema,
  scheduleBroadcastInputSchema,
} from "../schemas/deals";
import type { AgentHandler, AgentHandlerResult } from "../withAgent";
import {
  checkCaps,
  getCampaignLimits,
  loadDailyUsage,
  recordedRecipientCount,
} from "./campaignLimits";
import { checkBroadcastTemplate, resolveRecipients, validateVariableMapping } from "./recipients";

type Args<T> = { ctx: AgentContext; input: T };

/** This deployment's own address, for the sender's slice hand-over (see src/lib/broadcast-chain.ts). */
export function broadcastOrigin(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** What the sender reads from Broadcast.variableMapping, plus the AI's own marker. */
export function parseMapping(raw: string): {
  object: Record<string, unknown>;
  selectedContactIds: string[] | null;
  groupId: string | null;
} {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== "object" || Array.isArray(o)) return { object: {}, selectedContactIds: null, groupId: null };
    const ids = Array.isArray(o.selectedContactIds) ? o.selectedContactIds.filter((x): x is string => typeof x === "string") : null;
    return {
      object: o,
      selectedContactIds: ids && ids.length ? ids : null,
      groupId: typeof o.groupId === "string" && o.groupId ? o.groupId : null,
    };
  } catch {
    return { object: {}, selectedContactIds: null, groupId: null };
  }
}

const launchVerdict = () => TOOLS.launch_broadcast.default;

// ── draft_broadcast ─────────────────────────────────────────────────────────

export const draftBroadcast: AgentHandler<z.infer<typeof draftBroadcastBodySchema>> = async ({ ctx, input }) => {
  const limits = await getCampaignLimits();

  const template = await prisma.template.findUnique({
    where: { id: input.templateId },
    select: { id: true, name: true, category: true, body: true, status: true, deletedAt: true },
  });
  if (!template || template.deletedAt) throw new AgentHttpError("not_found", "Template not found.");
  const tv = checkBroadcastTemplate(template, launchVerdict());
  if (!tv.ok) return refusal(ctx, tv.code, tv.message, 422);
  const mappingProblem = validateVariableMapping(template.body, input.variableMapping);
  if (mappingProblem) throw new AgentHttpError("invalid_input", mappingProblem);

  let group: { id: string; name: string } | null = null;
  if (input.groupId) {
    group = await prisma.broadcastGroup.findUnique({ where: { id: input.groupId }, select: { id: true, name: true } });
    if (!group) throw new AgentHttpError("not_found", "Group not found.");
  }

  const rec = await resolveRecipients(input.groupId ? { groupId: input.groupId } : { contactIds: input.contactIds ?? [] });
  if (rec.truncated) {
    return refusal(ctx, "group_too_large", "This group is too large for the AI to message. Use a smaller group or pick contacts.", 422);
  }
  const usedToday = await loadDailyUsage(ctx.userId, new Date());
  const capped = checkCaps({ limits, recipients: rec.eligibleIds.length, usedOnDay: usedToday });
  if (capped) return refusal(ctx, capped.code, capped.message, capped.status);

  const created = await createBroadcastRecord({
    name: input.name,
    sourceType: "contacts",
    templateId: template.id,
    variableMapping: input.variableMapping,
    // The eligible people, frozen now. Never empty (that would mean "all contacts" to the sender).
    selectedContactIds: rec.eligibleIds,
    createdByUserId: ctx.userId,
    extraMapping: {
      agent: {
        recipientCount: rec.eligibleIds.length,
        source: group ? { type: "group", id: group.id, name: group.name } : { type: "contacts" },
      },
    },
  });
  if (!created.ok) return refusal(ctx, "draft_failed", created.error, created.status);

  return {
    body: {
      broadcast: { id: created.broadcast.id, status: "draft" as const },
      eligibleRecipients: rec.eligibleIds.length,
      excluded: rec.excluded,
      limits: { ...limits, usedToday },
      template: { id: template.id, name: template.name, category: tv.category },
      nextStep: "Nothing has been sent. Use launch_broadcast or schedule_broadcast; a person approves it first.",
    },
    recordIds: [created.broadcast.id, template.id],
    fieldsChanged: ["broadcast"],
  };
};

// ── get_broadcast_status ────────────────────────────────────────────────────

export const getBroadcastStatus: AgentHandler<unknown> = async ({ ctx, params }) => {
  const id = requireId(params.id, "Broadcast");
  const b = await prisma.broadcast.findFirst({
    where: { id, createdByUserId: ctx.userId },
    select: {
      id: true,
      name: true,
      status: true,
      total: true,
      sent: true,
      delivered: true,
      read: true,
      failed: true,
      scheduledAt: true,
      launchedAt: true,
      completedAt: true,
      createdAt: true,
      pauseRequestedAt: true,
      variableMapping: true,
    },
  });
  if (!b) throw new AgentHttpError("not_found", "Broadcast not found.");
  return {
    body: {
      id: b.id,
      name: b.name,
      status: b.status,
      pauseRequested: b.status === "running" && !!b.pauseRequestedAt,
      recipients: b.total > 0 ? b.total : recordedRecipientCount(b.variableMapping),
      sent: b.sent,
      delivered: b.delivered,
      read: b.read,
      failed: b.failed,
      scheduledAt: toIso(b.scheduledAt),
      launchedAt: toIso(b.launchedAt),
      completedAt: toIso(b.completedAt),
      createdAt: b.createdAt.toISOString(),
    },
    recordIds: [b.id],
  };
};

// ── pause_broadcast ─────────────────────────────────────────────────────────

/**
 * The fail-safe stop. A running broadcast gets the same pause request the human
 * Pause button makes; a scheduled one goes back to draft (the same as cancelling
 * its schedule). Anything else is either already stopped or has nothing to stop.
 */
export const pauseBroadcast: AgentHandler<unknown> = async ({ ctx, params }) => {
  const id = requireId(params.id, "Broadcast");
  const b = await prisma.broadcast.findFirst({
    where: { id, createdByUserId: ctx.userId },
    select: { id: true, status: true },
  });
  if (!b) throw new AgentHttpError("not_found", "Broadcast not found.");

  if (b.status === "running") {
    const paused = await requestBroadcastPause(b.id, b.status);
    if (!paused.ok) return refusal(ctx, "not_pausable", paused.error, 409, [b.id]);
    return {
      body: { id: b.id, status: "running", outcome: "pause_requested" as const },
      recordIds: [b.id],
      fieldsChanged: ["pauseRequestedAt"],
    };
  }
  if (b.status === "scheduled") {
    const reverted = await prisma.broadcast.updateMany({
      where: { id: b.id, status: "scheduled" },
      data: { status: "draft", scheduledAt: null },
    });
    if (reverted.count === 0) {
      return refusal(ctx, "not_pausable", "The broadcast changed state; check get_broadcast_status.", 409, [b.id]);
    }
    return {
      body: { id: b.id, status: "draft", outcome: "schedule_cancelled" as const },
      recordIds: [b.id],
      fieldsChanged: ["status", "scheduledAt"],
    };
  }
  if (b.status === "paused") {
    return { body: { id: b.id, status: "paused", outcome: "already_stopped" as const }, recordIds: [b.id], fieldsChanged: [] };
  }
  return refusal(ctx, "not_pausable", `Cannot pause a ${b.status} broadcast.`, 409, [b.id]);
};

// ── launch_broadcast / schedule_broadcast (APPROVAL) ────────────────────────

type OwnBroadcast = {
  id: string;
  status: string;
  sourceType: string;
  variableMapping: string;
  template: { id: string; category: string | null; status: string | null; deletedAt: Date | null } | null;
};

async function loadOwnBroadcast(ctx: AgentContext, id: string): Promise<OwnBroadcast> {
  const b = (await prisma.broadcast.findFirst({
    where: { id, createdByUserId: ctx.userId },
    select: {
      id: true,
      status: true,
      sourceType: true,
      variableMapping: true,
      template: { select: { id: true, category: true, status: true, deletedAt: true } },
    },
  })) as OwnBroadcast | null;
  if (!b) throw new AgentHttpError("not_found", "Broadcast not found.");
  return b;
}

/**
 * Everything that must still be true when a person's approval is carried out:
 * saved-contacts source with a frozen list, an approved template, and the caps
 * applied to who is eligible NOW (opt-outs and consent are read again). `usageAt`
 * is the day the campaign counts against.
 */
async function recheck(
  ctx: AgentContext,
  b: OwnBroadcast,
  usageAt: Date,
): Promise<{ ok: true; eligible: number } | { ok: false; result: AgentHandlerResult }> {
  const no = (code: string, message: string, status = 422) => ({ ok: false as const, result: refusal(ctx, code, message, status, [b.id]) });
  const mapping = parseMapping(b.variableMapping);
  if (b.sourceType !== "contacts" || mapping.groupId || !mapping.selectedContactIds) {
    return no("source_not_allowed", "The AI may only send campaigns to a saved list of contacts.");
  }
  if (!b.template) return no("template_not_approved", "This campaign's template is no longer available.");
  const tv = checkBroadcastTemplate(b.template, launchVerdict());
  if (!tv.ok) return no(tv.code, tv.message);

  const limits = await getCampaignLimits({ fresh: true });
  const rec = await resolveRecipients({ contactIds: mapping.selectedContactIds });
  const usedOnDay = await loadDailyUsage(ctx.userId, usageAt, b.id);
  const capped = checkCaps({ limits, recipients: rec.eligibleIds.length, usedOnDay });
  if (capped) return no(capped.code, capped.message, capped.status);
  return { ok: true, eligible: rec.eligibleIds.length };
}

export async function launchBroadcast({ ctx, input }: Args<z.infer<typeof launchBroadcastInputSchema>>): Promise<AgentHandlerResult> {
  const b = await loadOwnBroadcast(ctx, input.broadcastId);
  if (b.status !== "draft" && b.status !== "scheduled") {
    return refusal(ctx, "not_launchable", `This broadcast is already ${b.status}.`, 409, [b.id]);
  }
  const check = await recheck(ctx, b, new Date());
  if (!check.ok) return check.result;

  const started = await startBroadcast(b.id, broadcastOrigin(), {
    // The list the sender just built must also fit: the last gate before anything is sent.
    verifyTotal: async (total) => {
      const limits = await getCampaignLimits({ fresh: true });
      const usedOnDay = await loadDailyUsage(ctx.userId, new Date(), b.id);
      return checkCaps({ limits, recipients: total, usedOnDay }) === null;
    },
  });
  if (started.kind === "not_launchable") {
    return refusal(ctx, "not_launchable", "This broadcast was already launched or changed.", 409, [b.id]);
  }
  if (started.kind === "over_limit") {
    return refusal(
      ctx,
      "over_limit",
      `The recipient list came out at ${started.total}, outside the approved limits, so nothing was sent.`,
      422,
      [b.id],
    );
  }
  if (started.kind === "failed") {
    console.error("[agent] broadcast could not start", { broadcastId: b.id, error: (started.error as Error)?.name });
    throw new AgentHttpError("internal", "The broadcast could not be started and was marked failed.", 502);
  }
  return {
    body: { id: b.id, status: "running" as const, recipients: started.total },
    recordIds: [b.id],
    fieldsChanged: ["status", "launchedAt"],
  };
}

export async function scheduleBroadcast({ ctx, input }: Args<z.infer<typeof scheduleBroadcastInputSchema>>): Promise<AgentHandlerResult> {
  const at = new Date(input.scheduledAt);
  const problem = scheduleWindowError(at);
  if (problem) return refusal(ctx, "invalid_schedule", problem, 422, [input.broadcastId]);

  const b = await loadOwnBroadcast(ctx, input.broadcastId);
  if (b.status !== "draft" && b.status !== "scheduled") {
    return refusal(ctx, "not_schedulable", `A ${b.status} broadcast cannot be scheduled.`, 409, [b.id]);
  }
  const check = await recheck(ctx, b, at);
  if (!check.ok) return check.result;

  // Keep the recorded recipient count current: it is what the day's usage counts until the send builds the list.
  const mapping = parseMapping(b.variableMapping);
  const agent = (mapping.object.agent && typeof mapping.object.agent === "object" ? mapping.object.agent : {}) as Record<string, unknown>;
  const variableMapping = JSON.stringify({ ...mapping.object, agent: { ...agent, recipientCount: check.eligible } });

  const updated = await prisma.broadcast.updateMany({
    where: { id: b.id, createdByUserId: ctx.userId, status: { in: ["draft", "scheduled"] } },
    data: { status: "scheduled", scheduledAt: at, variableMapping },
  });
  if (updated.count === 0) {
    return refusal(ctx, "not_schedulable", "This broadcast was launched or changed in the meantime.", 409, [b.id]);
  }
  return {
    body: { id: b.id, status: "scheduled" as const, scheduledAt: at.toISOString(), recipients: check.eligible },
    recordIds: [b.id],
    fieldsChanged: ["status", "scheduledAt"],
  };
}
