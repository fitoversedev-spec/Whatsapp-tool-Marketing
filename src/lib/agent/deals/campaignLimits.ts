import { prisma } from "@/lib/prisma";

/**
 * The hard caps on what the AI may put into a broadcast: "no bulk messaging
 * outside approved campaign limits".
 *
 * Setting `agent_campaign_limits` (JSON) overrides the defaults:
 *   { "maxRecipients": 200, "maxPerDay": 500 }
 *   maxRecipients  most people in ONE campaign
 *   maxPerDay      most recipients across ALL the AI's campaigns in one India (IST)
 *                  day, counting campaigns already sent and ones scheduled for it
 *
 * The caps are checked when the draft is made AND again when a launch or
 * schedule is carried out, because contacts, consent and opt-outs change in
 * between, and a person approving a campaign is approving it within the limits.
 */
export const CAMPAIGN_LIMITS_KEY = "agent_campaign_limits";
export const DEFAULT_CAMPAIGN_LIMITS = { maxRecipients: 200, maxPerDay: 500 } as const;
// A stored value outside these bounds is ignored (the default stays).
export const MAX_RECIPIENTS_CEILING = 5000;
export const MAX_PER_DAY_CEILING = 20_000;
/** More campaigns than this in one day and the day counts as full. */
const USAGE_ROW_LIMIT = 500;

export type CampaignLimits = { maxRecipients: number; maxPerDay: number };

function boundedInt(v: unknown, max: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max ? v : null;
}

/** Pure: a stored JSON value -> the limits. Anything invalid falls back to the default. */
export function resolveCampaignLimits(stored: unknown): CampaignLimits {
  const out: CampaignLimits = { ...DEFAULT_CAMPAIGN_LIMITS };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  const s = stored as Record<string, unknown>;
  out.maxRecipients = boundedInt(s.maxRecipients, MAX_RECIPIENTS_CEILING) ?? out.maxRecipients;
  out.maxPerDay = boundedInt(s.maxPerDay, MAX_PER_DAY_CEILING) ?? out.maxPerDay;
  return out;
}

let cache: { at: number; value: CampaignLimits } | null = null;
export function resetCampaignLimitsCache(): void {
  cache = null;
}

/**
 * The limits in force. A launch or schedule being carried out passes
 * `fresh: true` so it never relies on a value cached before the approval.
 * A failed read throws (the request fails) rather than falling back to a
 * default that might be looser than what the owner set.
 */
export async function getCampaignLimits(opts: { fresh?: boolean } = {}): Promise<CampaignLimits> {
  if (!opts.fresh && cache && Date.now() - cache.at < 15_000) return cache.value;
  const row = await prisma.setting.findUnique({ where: { key: CAMPAIGN_LIMITS_KEY } });
  let stored: unknown = null;
  if (row?.value) {
    try {
      stored = JSON.parse(row.value);
    } catch {
      stored = null;
    }
  }
  const value = resolveCampaignLimits(stored);
  cache = { at: Date.now(), value };
  return value;
}

export type CapRefusal = {
  code: "no_eligible_recipients" | "over_recipient_cap" | "over_daily_cap";
  message: string;
  status: number;
};

/** Pure: does this many recipients fit the limits, given what the day has already used? */
export function checkCaps(args: { limits: CampaignLimits; recipients: number; usedOnDay: number }): CapRefusal | null {
  const { limits, recipients, usedOnDay } = args;
  if (recipients < 1) {
    return {
      code: "no_eligible_recipients",
      message: "None of these contacts can be messaged: they are opted out or have not given campaign consent.",
      status: 422,
    };
  }
  if (recipients > limits.maxRecipients) {
    return {
      code: "over_recipient_cap",
      message: `A campaign may have at most ${limits.maxRecipients} recipients; this one has ${recipients}.`,
      status: 422,
    };
  }
  if (usedOnDay + recipients > limits.maxPerDay) {
    return {
      code: "over_daily_cap",
      message: `The AI may message at most ${limits.maxPerDay} people a day; ${usedOnDay} are already sent or scheduled for that day, so ${recipients} more would go over.`,
      status: 429,
    };
  }
  return null;
}

// ---- how much of a day is already used -------------------------------------

const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** The India (IST) calendar day that contains `at`. */
export function istDayRange(at: Date): { start: Date; end: Date } {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  const startMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS - 1) };
}

/** The recipient count recorded in a draft's variableMapping blob, or 0. */
export function recordedRecipientCount(variableMapping: string | null | undefined): number {
  if (!variableMapping) return 0;
  try {
    const n = (JSON.parse(variableMapping) as { agent?: { recipientCount?: unknown } })?.agent?.recipientCount;
    return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Pure: how many people this broadcast uses of its day. */
export function broadcastVolume(row: { status: string; total: number; variableMapping: string }): number {
  // A failed broadcast only used what it actually got to build; the rest never sent.
  if (row.status === "failed") return row.total;
  return row.total > 0 ? row.total : recordedRecipientCount(row.variableMapping);
}

/**
 * Recipients of the AI's campaigns that fall on the IST day containing `at`:
 * launched that day, or (not yet launched) scheduled for it. Drafts do not count
 * until they are scheduled or launched. `excludeBroadcastId` leaves one out (the
 * one being checked).
 */
export async function loadDailyUsage(userId: string, at: Date, excludeBroadcastId?: string): Promise<number> {
  const { start, end } = istDayRange(at);
  const rows = await prisma.broadcast.findMany({
    where: {
      createdByUserId: userId,
      ...(excludeBroadcastId ? { id: { not: excludeBroadcastId } } : {}),
      status: { in: ["scheduled", "running", "paused", "completed", "failed"] },
      OR: [{ launchedAt: { gte: start, lte: end } }, { launchedAt: null, scheduledAt: { gte: start, lte: end } }],
    },
    select: { status: true, total: true, variableMapping: true },
    take: USAGE_ROW_LIMIT,
  });
  // So many campaigns that we cannot add them all up: treat the day as full.
  if (rows.length >= USAGE_ROW_LIMIT) return Number.MAX_SAFE_INTEGER;
  return rows.reduce((sum, r) => sum + broadcastVolume(r), 0);
}
