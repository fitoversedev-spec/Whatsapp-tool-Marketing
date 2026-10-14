import { AREA_TOOLS } from "./registry";
import { prisma } from "@/lib/prisma";

/**
 * What the agent may do, decided in code and enforced by the backend — never by
 * the agent's own prompt.
 *
 *   ALLOWED   run it now
 *   APPROVAL  queue an AgentApprovalRequest; a human decides
 *   NEVER     refuse, always
 *
 * The code default is the ceiling. An admin can add overrides in the Setting
 * row `agent_permission_overrides` (JSON: { "<tool>": "APPROVAL" | "NEVER" }),
 * but an override can only make a tool STRICTER than its default; it can never
 * grant more. To permit more, change the code default and ship it. An unknown
 * tool is NEVER.
 */
export type Verdict = "ALLOWED" | "APPROVAL" | "NEVER";
export type ToolAction = "read" | "create" | "update" | "send" | "delete";

export type ToolDefinition = {
  default: Verdict;
  action: ToolAction;
  /**
   * Marks tools whose verdict must not drift toward ALLOWED by any means other
   * than editing this file. Overrides are tighten-only for every tool today, so
   * this is a second lock: effectiveVerdict() honours it explicitly, and a
   * future "loosen" feature must skip these tools.
   */
  neverLoosen?: boolean;
  /** Rate-limit group; defaults to the action ("read", "send", ...). */
  group?: string;
};

const CORE_TOOLS: Record<string, ToolDefinition> = {
  // Stage 0: the connection test. Later stages register theirs in ./registry/<area>.ts.
  whoami: { default: "ALLOWED", action: "read" },
};

// Area tools come from ./registry; a name may only be defined once.
export const TOOL_REGISTRY: Record<string, ToolDefinition> = Object.assign({}, CORE_TOOLS, ...AREA_TOOLS);

const STRICTNESS: Record<Verdict, number> = { ALLOWED: 0, APPROVAL: 1, NEVER: 2 };
const VERDICTS = Object.keys(STRICTNESS) as Verdict[];

export function isVerdict(v: unknown): v is Verdict {
  return typeof v === "string" && (VERDICTS as string[]).includes(v);
}

export function toolGroup(tool: string): string {
  const def = Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, tool) ? TOOL_REGISTRY[tool] : undefined;
  return def ? (def.group ?? def.action) : "unknown";
}

/**
 * Pure: the verdict for `tool` given the (already parsed) overrides.
 * Anything malformed in `overrides` is ignored, which can only leave the code
 * default in place, never loosen it.
 */
export function effectiveVerdict(tool: string, overrides?: unknown): Verdict {
  if (!Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, tool)) return "NEVER";
  const def = TOOL_REGISTRY[tool];
  let verdict: Verdict = def.default;
  if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
    const o = Object.prototype.hasOwnProperty.call(overrides, tool)
      ? (overrides as Record<string, unknown>)[tool]
      : undefined;
    // Tighten-only: an override that is not strictly stricter is ignored. This
    // holds for every tool, `neverLoosen` ones included.
    if (isVerdict(o) && STRICTNESS[o] > STRICTNESS[verdict]) verdict = o;
  }
  return verdict;
}

export function effectiveTable(overrides?: unknown): Record<string, Verdict> {
  const table: Record<string, Verdict> = {};
  for (const tool of Object.keys(TOOL_REGISTRY)) table[tool] = effectiveVerdict(tool, overrides);
  return table;
}

// ---- overrides from the Setting table, cached briefly ----------------------

const OVERRIDES_KEY = "agent_permission_overrides";
const OVERRIDES_TTL_MS = 15_000;
let cache: { at: number; value: unknown } | null = null;

export function parseOverrides(raw: string | null | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function loadOverrides(): Promise<unknown> {
  if (cache && Date.now() - cache.at < OVERRIDES_TTL_MS) return cache.value;
  const row = await prisma.setting.findUnique({ where: { key: OVERRIDES_KEY } });
  const value = parseOverrides(row?.value);
  cache = { at: Date.now(), value };
  return value;
}

export function resetOverridesCache(): void {
  cache = null;
}

export async function getEffectiveVerdict(tool: string): Promise<Verdict> {
  return effectiveVerdict(tool, await loadOverrides());
}

export async function getEffectiveTable(): Promise<Record<string, Verdict>> {
  return effectiveTable(await loadOverrides());
}
