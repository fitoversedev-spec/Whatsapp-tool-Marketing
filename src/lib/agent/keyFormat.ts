import { createHash, randomBytes } from "node:crypto";
import type { AgentEnvironment } from "./context";

/**
 * Pure key-format helpers — no database, no `server-only` — so the operator
 * script (scripts/agent-keys.ts) can mint keys with exactly the same code the
 * API verifies them with.
 *
 * Format:  fvai_<env3>_<keyId>_<secret>
 *   env3    dev | stg | prd
 *   keyId   16 lowercase hex chars (public; looked up in the database)
 *   secret  32 random bytes, base64url (43 chars; only its hash is stored)
 * base64url can contain "_", so the key is parsed with a strict pattern rather
 * than split on underscores.
 */

const ENV3: Record<AgentEnvironment, "dev" | "stg" | "prd"> = {
  development: "dev",
  staging: "stg",
  production: "prd",
};
const ENV_FROM_ENV3: Record<string, AgentEnvironment> = {
  dev: "development",
  stg: "staging",
  prd: "production",
};

const KEY_PATTERN = /^fvai_(dev|stg|prd)_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/;

export type ParsedKey = {
  environment: AgentEnvironment;
  env3: "dev" | "stg" | "prd";
  keyId: string;
  secret: string;
};

export function hashSecret(secret: string): string {
  // The pepper lives only in the server environment (and the operator's shell
  // when issuing keys), never in the database — a leaked table alone can't be
  // brute-forced offline. Must be identical wherever keys are issued/verified.
  const pepper = process.env.AGENT_KEY_PEPPER ?? "";
  return createHash("sha256").update(secret + pepper, "utf8").digest("hex");
}

export function keyPrefix(env: AgentEnvironment, keyId: string): string {
  return `fvai_${ENV3[env]}_${keyId}`;
}

export function generateKey(env: AgentEnvironment): { key: string; keyId: string; secretHash: string } {
  const keyId = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return { key: `${keyPrefix(env, keyId)}_${secret}`, keyId, secretHash: hashSecret(secret) };
}

export function parseKey(input: string): ParsedKey | null {
  if (typeof input !== "string" || input.length > 200) return null;
  const m = KEY_PATTERN.exec(input);
  if (!m) return null;
  return { env3: m[1] as ParsedKey["env3"], environment: ENV_FROM_ENV3[m[1]], keyId: m[2], secret: m[3] };
}
