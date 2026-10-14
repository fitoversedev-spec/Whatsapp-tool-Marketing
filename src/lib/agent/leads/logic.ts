/**
 * The decisions behind the AI Sales Agent's lead tools, kept free of the
 * database so they can be tested on their own: how custom fields merge, when a
 * create is a duplicate, who an escalation goes to, which tasks the AI may
 * complete, and how a due date is checked.
 */
import { normalizePhone } from "@/lib/phone";

// ── custom fields ───────────────────────────────────────────────────────────

/** Keys the AI writes for requirements all live under this namespace. */
export const AGENT_FIELD_PREFIX = "agent.";

/** Plain label-ish keys; the leading alphanumeric also rules out "__proto__". */
export const CUSTOM_FIELD_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9 _.\-/()]{0,59}$/;
export const MAX_CUSTOM_FIELDS_PER_CALL = 30;
export const MAX_CUSTOM_FIELDS_TOTAL = 100;

/** update_lead_details may not touch the keys set_requirements owns. */
export function isReservedFieldKey(key: string): boolean {
  return key.toLowerCase().startsWith(AGENT_FIELD_PREFIX);
}

export type MergeResult =
  | { ok: true; fields: Record<string, string>; changedKeys: string[] }
  | { ok: false; error: string };

/**
 * The human PATCH replaces a contact's custom fields wholesale; the AI must
 * only add or update keys. Untouched keys survive, and a value of "" clears
 * what a key holds without removing the key.
 */
export function mergeCustomFields(
  existing: Record<string, string>,
  patch: Record<string, string>,
  maxTotal = MAX_CUSTOM_FIELDS_TOTAL,
): MergeResult {
  const fields: Record<string, string> = { ...existing };
  const changedKeys: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!CUSTOM_FIELD_KEY_RE.test(key) || isReservedFieldKey(key)) {
      return { ok: false, error: `"${key}" is not an allowed custom field name.` };
    }
    if (fields[key] !== value) changedKeys.push(key);
    fields[key] = value;
  }
  if (Object.keys(fields).length > maxTotal) {
    return { ok: false, error: `A lead can hold at most ${maxTotal} custom fields.` };
  }
  return { ok: true, fields, changedKeys };
}

/** Merge for the namespaced requirement keys: null removes a key. */
export function applyFieldPatch(
  existing: Record<string, string>,
  patch: Record<string, string | null>,
): { fields: Record<string, string>; changedKeys: string[] } {
  const fields: Record<string, string> = { ...existing };
  const changedKeys: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      if (key in fields) {
        delete fields[key];
        changedKeys.push(key);
      }
    } else {
      if (fields[key] !== value) changedKeys.push(key);
      fields[key] = value;
    }
  }
  return { fields, changedKeys };
}

// ── requirements (AccountContact.fields["agent.*"]) ─────────────────────────

export type RequirementsInput = {
  sport?: string | null;
  budgetInr?: number | null;
  location?: string | null;
  city?: string | null;
  courtLengthFt?: number | null;
  courtWidthFt?: number | null;
  surfacePreferences?: string[] | null;
  timeline?: string | null;
  b2bOrB2c?: string | null;
  civilWorkNeeded?: boolean | null;
  notes?: string | null;
};

export const REQUIREMENT_KEYS = [
  "sport",
  "budgetInr",
  "location",
  "city",
  "courtLengthFt",
  "courtWidthFt",
  "surfacePreferences",
  "timeline",
  "b2bOrB2c",
  "civilWorkNeeded",
  "notes",
] as const satisfies readonly (keyof RequirementsInput)[];

function stored(key: keyof RequirementsInput, value: unknown): string | null {
  if (value === null) return null;
  if (key === "civilWorkNeeded") return value ? "yes" : "no";
  if (key === "surfacePreferences") return (value as string[]).join(", ");
  return String(value);
}

/** Only the keys the caller sent: value = the stored string, or null to clear. */
export function requirementPatch(input: RequirementsInput): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  for (const key of REQUIREMENT_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    patch[`${AGENT_FIELD_PREFIX}${key}`] = stored(key, value);
  }
  return patch;
}

// ── due dates ───────────────────────────────────────────────────────────────

export const MAX_TASK_HORIZON_DAYS = 180;

/** null when `iso` is a valid future date within 180 days, else the reason it isn't. */
export function checkDueAt(iso: string, now: Date = new Date()): string | null {
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return "dueAt is not a valid date.";
  if (due.getTime() <= now.getTime()) return "dueAt must be in the future.";
  if (due.getTime() > now.getTime() + MAX_TASK_HORIZON_DAYS * 24 * 60 * 60 * 1000) {
    return `dueAt must be within ${MAX_TASK_HORIZON_DAYS} days from now.`;
  }
  return null;
}

// ── create_lead: natural key + duplicates ───────────────────────────────────

export const NATURAL_KEY_WINDOW_MS = 10 * 60 * 1000;

/**
 * The lead the AI itself created for this phone in the last 10 minutes, if any:
 * a retry (with a fresh Idempotency-Key) gets that lead back instead of a twin.
 * `rows` should already be limited to the AI's own recent creations.
 */
export function findRecentSamePhone<T extends { phone: string | null; createdAt: Date }>(
  rows: T[],
  phone: string,
  now: Date = new Date(),
): T | null {
  const target = normalizePhone(phone);
  if (!target) return null;
  const cutoff = now.getTime() - NATURAL_KEY_WINDOW_MS;
  for (const row of rows) {
    if (row.createdAt.getTime() < cutoff || !row.phone) continue;
    if (normalizePhone(row.phone) === target) return row;
  }
  return null;
}

/** "******3210" — enough to recognise a number, not enough to copy it. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 4 ? "****" : `${"*".repeat(Math.min(digits.length - 4, 8))}${digits.slice(-4)}`;
}

export type DuplicateMatch =
  | { kind: "company"; id: string; name: string; city: string | null }
  | {
      kind: "person";
      id: string;
      name: string;
      phoneMasked: string | null;
      company: string | null;
      stage: string | null;
      isLead: boolean;
      ownerAssigned: boolean;
    };

export type DuplicateDecision =
  | { action: "create"; confirmedDespite: string | null }
  | { action: "conflict" };

/**
 * Possible duplicates stop a create unless the caller says, with a reason, that
 * they are not the same lead. A reason on its own does not count.
 */
export function decideDuplicate(
  matches: DuplicateMatch[],
  opts: { confirmNotDuplicate?: boolean; duplicateReason?: string | null },
): DuplicateDecision {
  if (matches.length === 0) return { action: "create", confirmedDespite: null };
  const reason = opts.duplicateReason?.trim();
  if (opts.confirmNotDuplicate === true && reason) return { action: "create", confirmedDespite: reason };
  return { action: "conflict" };
}

/** First configured slug that exists wins: the AI's own source, else the closest one. */
export const AI_LEAD_SOURCE_SLUGS = ["ai_sales_agent", "whatsapp_inbound"] as const;

export function pickLeadSourceId(rows: { id: string; slug: string }[]): string | null {
  for (const slug of AI_LEAD_SOURCE_SLUGS) {
    const hit = rows.find((r) => r.slug === slug);
    if (hit) return hit.id;
  }
  return null;
}

// ── people the AI may hand a lead to ────────────────────────────────────────

export type PersonState = {
  role: string;
  isActive: boolean;
  approvalStatus: string;
  deletedAt: Date | null;
};

export const ASSIGNABLE_ROLES = ["sales", "manager"] as const;

/** A real, active, approved salesperson or manager — never the AI, an admin seat or a closed account. */
export function isAssignableHuman(user: PersonState | null | undefined): boolean {
  return (
    !!user &&
    !user.deletedAt &&
    user.isActive &&
    user.approvalStatus === "approved" &&
    (ASSIGNABLE_ROLES as readonly string[]).includes(user.role)
  );
}

// ── escalation ──────────────────────────────────────────────────────────────

export const ESCALATION_TARGETS = ["sales", "civil_engineer", "manager"] as const;
export type EscalationTarget = (typeof ESCALATION_TARGETS)[number];

export const ESCALATION_LABEL: Record<EscalationTarget, string> = {
  sales: "sales",
  civil_engineer: "civil engineer",
  manager: "manager",
};

export type EscalationConfig = Record<EscalationTarget, string[]>;

/** The Setting `agent_escalation_targets`: { sales: [userId…], civil_engineer: […], manager: […] }. Anything malformed means "not configured". */
export function parseEscalationTargets(raw: string | null | undefined): EscalationConfig {
  const empty: EscalationConfig = { sales: [], civil_engineer: [], manager: [] };
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
  for (const target of ESCALATION_TARGETS) {
    const list = (parsed as Record<string, unknown>)[target];
    if (Array.isArray(list)) {
      empty[target] = Array.from(new Set(list.filter((v): v is string => typeof v === "string" && v.length > 0))).slice(0, 20);
    }
  }
  return empty;
}

export type EscalationOwner = { userId: string; source: "configured" | "rep" | "admin" };

/**
 * Who gets the escalation: the first configured person for that target, else
 * the lead's own rep, else an active admin. `eligible` is the set of user ids
 * that are active, approved and human; anyone outside it is skipped.
 */
export function resolveEscalationOwner(args: {
  configuredIds: string[];
  repId: string | null;
  adminIds: string[];
  eligible: ReadonlySet<string>;
}): EscalationOwner | null {
  const ok = (id: string) => args.eligible.has(id);
  const configured = args.configuredIds.find(ok);
  if (configured) return { userId: configured, source: "configured" };
  if (args.repId && ok(args.repId)) return { userId: args.repId, source: "rep" };
  const admin = args.adminIds.find(ok);
  if (admin) return { userId: admin, source: "admin" };
  return null;
}

export function escalationTaskText(target: EscalationTarget, reason: string): string {
  return `Escalated to ${ESCALATION_LABEL[target]}: ${reason}`.slice(0, 500);
}

/** How long an open escalation of the same lead to the same target blocks a repeat. */
export const ESCALATION_REPEAT_WINDOW_MS = 60 * 60 * 1000;
/** An escalation's follow-up falls due this soon. */
export const ESCALATION_DUE_IN_MS = 15 * 60 * 1000;

// ── tasks ───────────────────────────────────────────────────────────────────

/** The AI may close the follow-ups it opened itself, never a human's. */
export function canAgentCompleteTask(task: { createdByUserId: string }, agentUserId: string): boolean {
  return task.createdByUserId === agentUserId;
}

// ── wording ─────────────────────────────────────────────────────────────────

/** "AI conversation summary — 13 Oct 2026" (IST, the app's day). */
export function summaryTitle(now: Date = new Date()): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(now);
  return `AI conversation summary — ${date}`;
}
