/**
 * The authenticated caller on /api/agent/v1/**.
 *
 * This is deliberately NOT a User row and is never produced by getCurrentUser():
 * nothing in the human app can receive one, and nothing in the human app
 * accepts an API key. `userId` is the "ai_agent" service User that CRM records
 * the agent creates will be owned by — it is data, not a login.
 */
export type AgentEnvironment = "development" | "staging" | "production";

export const AGENT_ENVIRONMENTS: readonly AgentEnvironment[] = ["development", "staging", "production"];

export type AgentContext = {
  identityId: string;
  userId: string;
  credentialId: string;
  environment: AgentEnvironment;
  correlationId: string;
  ip: string | null;
};

/** Safe-to-show facts about the key that was used (never the secret). */
export type AgentCredentialMeta = {
  identityName: string;
  credentialLabel: string;
  /** "fvai_stg_<keyId>" — identifies the key without being able to use it. */
  keyPrefix: string;
  expiresAt: Date | null;
};

/**
 * Which environment THIS deployment serves (AGENT_API_ENV). A key only works
 * where its environment matches, so a staging key can never act on production
 * data. Unset or unrecognised means "none": the API refuses every key.
 */
export function serverEnvironment(): AgentEnvironment | null {
  const v = process.env.AGENT_API_ENV;
  return (AGENT_ENVIRONMENTS as readonly string[]).includes(v ?? "") ? (v as AgentEnvironment) : null;
}
