import "server-only";

import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { after } from "@/lib/scout/after";
import {
  AGENT_ENVIRONMENTS,
  serverEnvironment,
  type AgentContext,
  type AgentCredentialMeta,
  type AgentEnvironment,
} from "./context";
import { hashSecret, keyPrefix, parseKey } from "./keyFormat";

/**
 * THE credential verifier. This is the only place an agent API key is turned
 * into an identity, and it is imported only by src/lib/agent/withAgent.ts —
 * a vitest (boundary.test.ts) fails if any file outside src/lib/agent or
 * src/app/api/agent touches it. getCurrentUser(), requireUser() and the
 * middleware never see a Bearer key.
 */
export { generateKey, parseKey, hashSecret } from "./keyFormat";

/** Why a credential was refused. Internal only: callers always see the same generic 401. */
export type DenialReason =
  | "missing_credential"
  | "malformed_credential"
  | "unknown_key"
  | "bad_secret"
  | "revoked"
  | "expired"
  | "identity_inactive"
  | "environment_mismatch"
  | "ip_not_allowed"
  | "server_misconfigured";

export type VerifyResult =
  | { ok: true; context: Omit<AgentContext, "correlationId">; meta: AgentCredentialMeta }
  | {
      ok: false;
      reason: DenialReason;
      ip: string | null;
      /** Known only when the key id resolved to a real credential — lets the audit log attribute the attempt. */
      identityId?: string;
      credentialId?: string;
      environment?: AgentEnvironment;
    };

type HeaderReader = { get(name: string): string | null };

const LAST_USED_INTERVAL_MS = 5 * 60 * 1000;

/** First hop of x-forwarded-for (the platform proxy sets it), else x-real-ip. */
export function clientIp(headers: HeaderReader): string | null {
  const xff = headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  const raw = first || headers.get("x-real-ip")?.trim() || "";
  if (!raw || raw.length > 64) return null;
  return raw.replace(/^::ffff:/i, "");
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

/** Exact match, or IPv4 CIDR ("203.0.113.0/24"). An empty allowlist allows any address. */
export function ipAllowed(ip: string | null, allowlist: unknown): boolean {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
  if (!ip) return false;
  for (const entry of allowlist) {
    if (typeof entry !== "string") continue;
    const rule = entry.trim().replace(/^::ffff:/i, "");
    if (rule === ip) return true;
    const slash = rule.indexOf("/");
    if (slash > 0) {
      const base = ipv4ToInt(rule.slice(0, slash));
      const bits = Number(rule.slice(slash + 1));
      const addr = ipv4ToInt(ip);
      if (base !== null && addr !== null && Number.isInteger(bits) && bits >= 0 && bits <= 32) {
        const size = 2 ** (32 - bits);
        if (Math.floor(base / size) === Math.floor(addr / size)) return true;
      }
    }
  }
  return false;
}

/** Constant-time comparison of two sha256 hex digests. */
export function hashesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  if (x.length !== 32 || y.length !== 32) return false;
  return timingSafeEqual(x, y);
}

const DUMMY_HASH = "0".repeat(64);

export async function verifyCredential(headers: HeaderReader): Promise<VerifyResult> {
  const ip = clientIp(headers);
  const deny = (
    reason: DenialReason,
    known?: { identityId: string; credentialId: string; environment: AgentEnvironment },
  ): VerifyResult => ({ ok: false, reason, ip, ...known });

  const serverEnv = serverEnvironment();
  if (!serverEnv) return deny("server_misconfigured");

  const auth = headers.get("authorization");
  if (!auth) return deny("missing_credential");
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(auth);
  if (!bearer) return deny("malformed_credential");
  const parsed = parseKey(bearer[1]);
  if (!parsed) return deny("malformed_credential");

  // Hash before the lookup so a wrong keyId and a wrong secret cost the same.
  const presentedHash = hashSecret(parsed.secret);

  const cred = await prisma.agentCredential.findUnique({
    where: { keyId: parsed.keyId },
    include: {
      identity: {
        select: {
          id: true,
          userId: true,
          name: true,
          status: true,
          user: { select: { role: true, isActive: true, deletedAt: true, approvalStatus: true } },
        },
      },
    },
  });

  const secretOk = hashesMatch(presentedHash, cred?.secretHash ?? DUMMY_HASH);
  if (!cred) return deny("unknown_key");
  if (!secretOk) return deny("bad_secret");

  const environment = (AGENT_ENVIRONMENTS as readonly string[]).includes(cred.environment)
    ? (cred.environment as AgentEnvironment)
    : undefined;
  const known = environment
    ? { identityId: cred.identityId, credentialId: cred.id, environment }
    : undefined;

  const now = Date.now();
  if (cred.revokedAt) return deny("revoked", known);
  if (cred.expiresAt && cred.expiresAt.getTime() <= now) return deny("expired", known);

  const { identity } = cred;
  const user = identity.user;
  if (
    identity.status !== "active" ||
    user.role !== "ai_agent" ||
    !user.isActive ||
    user.deletedAt ||
    user.approvalStatus !== "approved"
  ) {
    return deny("identity_inactive", known);
  }

  // The key's own environment must match its prefix AND this deployment.
  if (!environment || environment !== parsed.environment || environment !== serverEnv) {
    return deny("environment_mismatch", known);
  }

  if (!ipAllowed(ip, cred.ipAllowlist)) return deny("ip_not_allowed", known);

  // Bookkeeping only: at most once per 5 minutes, after the response is sent,
  // and never allowed to fail a request.
  if (!cred.lastUsedAt || now - cred.lastUsedAt.getTime() >= LAST_USED_INTERVAL_MS) {
    after(() =>
      prisma.agentCredential.update({
        where: { id: cred.id },
        data: { lastUsedAt: new Date(), lastUsedIp: ip },
      }),
    );
  }

  return {
    ok: true,
    context: {
      identityId: identity.id,
      userId: identity.userId,
      credentialId: cred.id,
      environment,
      ip,
    },
    meta: {
      identityName: identity.name,
      credentialLabel: cred.label,
      keyPrefix: keyPrefix(environment, cred.keyId),
      expiresAt: cred.expiresAt,
    },
  };
}
