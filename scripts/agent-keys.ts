// Operator tool for the Fitoverse AI Sales Agent's identity and API keys.
//
//   npx tsx scripts/agent-keys.ts <command> [flags] --confirm-host <db-host>
//
//   create-identity
//   issue   --env staging --label "Sales agent (staging)" --out <file> [--expires-days 90] [--ip 203.0.113.7]...
//   rotate  --key-id <id> --out <file> [--expires-days N]
//   revoke  --key-id <id> --reason "<why>"
//   list
//
// SAFETY
//  * This script does not load .env files (no dotenv). DATABASE_URL must be
//    exported in the shell you run it from. It is checked BEFORE @prisma/client is
//    even imported (Prisma would otherwise pull one in from a .env file), and
//    passed to the client explicitly, so the script can only touch a database you
//    named.
//  * It prints the database host and refuses to continue unless you pass the
//    same host as --confirm-host.
//  * `issue` / `rotate` write the full key ONLY to the file named by --out
//    (created exclusively, owner-readable, refused inside the repository). The
//    key is never printed; only its non-secret prefix is.
//  * Set AGENT_KEY_PEPPER in this shell to the same value the server uses, or
//    the server will not recognise the keys issued here.

import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
// Type-only: the real @prisma/client is imported dynamically in connect(), AFTER the
// DATABASE_URL check. Merely importing it makes Prisma load a .env file from the
// project root and fill in an unset DATABASE_URL, which would defeat that check.
import type { PrismaClient } from "@prisma/client";
import { AGENT_ENVIRONMENTS, type AgentEnvironment } from "../src/lib/agent/context";
import { generateKey, keyPrefix } from "../src/lib/agent/keyFormat";

const IDENTITY_NAME = "Fitoverse AI Sales Agent";
const IDENTITY_EMAIL = "ai-sales-agent@service.fitoverse.invalid";
// Not a bcrypt hash, so bcrypt.compare() can never succeed against it.
const DISABLED_PASSWORD_HASH = "!disabled-service-account";
const DAY_MS = 24 * 60 * 60 * 1000;

function die(message: string): never {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

// ---- argument parsing ------------------------------------------------------

type Flags = Record<string, string[]>;

function parseArgs(argv: string[]): { command: string | undefined; flags: Flags } {
  const [command, ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) die(`Unexpected argument "${a}".`);
    const name = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      (flags[name] ??= []).push("true");
    } else {
      (flags[name] ??= []).push(next);
      i++;
    }
  }
  return { command, flags };
}

const one = (flags: Flags, name: string): string | undefined => flags[name]?.[flags[name].length - 1];
const need = (flags: Flags, name: string): string => one(flags, name) ?? die(`Missing --${name}.`);

// ---- database guard --------------------------------------------------------

async function connect(flags: Flags): Promise<PrismaClient> {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    die(
      "DATABASE_URL is not set in this shell. This script does not load .env files; export DATABASE_URL for the " +
        "database you intend to change, then run it again.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    die("DATABASE_URL is not a valid URL.");
  }
  const host = url.hostname;
  console.log(`Target database -> host: ${host}   database: ${url.pathname.replace(/^\//, "") || "(default)"}`);
  const confirm = one(flags, "confirm-host");
  if (confirm !== host) {
    die(`Refusing to run. To confirm this is the database you mean, re-run with:  --confirm-host ${host}`);
  }
  if (host.includes("-pooler")) {
    if (!url.searchParams.has("pgbouncer")) url.searchParams.set("pgbouncer", "true");
    url.searchParams.set("connection_limit", "1");
  }
  const { PrismaClient: Client } = await import("@prisma/client");
  return new Client({ datasourceUrl: url.toString(), log: ["error"] });
}

// ---- helpers ---------------------------------------------------------------

function parseEnv(value: string): AgentEnvironment {
  if (!(AGENT_ENVIRONMENTS as readonly string[]).includes(value)) {
    die(`--env must be one of: ${AGENT_ENVIRONMENTS.join(", ")}.`);
  }
  return value as AgentEnvironment;
}

function parseIps(flags: Flags): string[] {
  const out: string[] = [];
  for (const raw of flags["ip"] ?? []) {
    for (const part of raw.split(",")) {
      const ip = part.trim();
      if (!ip) continue;
      if (!/^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(ip)) die(`"${ip}" is not an IP address or CIDR range.`);
      out.push(ip);
    }
  }
  return out;
}

function parseExpiry(flags: Flags): Date | null {
  const raw = one(flags, "expires-days");
  if (raw === undefined) return null;
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0 || days > 3650) die("--expires-days must be a number between 1 and 3650.");
  return new Date(Date.now() + days * DAY_MS);
}

/** Resolve --out; never inside the repository (a key file there could be committed). */
function resolveOut(flags: Flags): string {
  const out = path.resolve(need(flags, "out"));
  const rel = path.relative(process.cwd(), out);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    die(`Refusing to write a key file inside the repository (${out}). Choose a path outside it.`);
  }
  if (existsSync(out)) die(`${out} already exists. Choose a new path; existing files are never overwritten.`);
  return out;
}

function writeKeyFile(out: string, key: string): void {
  writeFileSync(out, `${key}\n`, { flag: "wx", mode: 0o600 });
}

async function requireIdentity(prisma: PrismaClient) {
  const user = await prisma.user.findUnique({ where: { email: IDENTITY_EMAIL } });
  const identity = user ? await prisma.agentIdentity.findUnique({ where: { userId: user.id } }) : null;
  if (!user || !identity) die("The agent identity does not exist yet. Run `create-identity` first.");
  if (identity.status !== "active") die(`The agent identity is "${identity.status}", not active.`);
  return identity;
}

const fmt = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + "Z" : "-");

function pepperNote(): string {
  return process.env.AGENT_KEY_PEPPER
    ? "AGENT_KEY_PEPPER is set in this shell (the server must use the same value)."
    : "AGENT_KEY_PEPPER is NOT set in this shell (the server must not have one either).";
}

// ---- commands --------------------------------------------------------------

async function createIdentity(prisma: PrismaClient) {
  let user = await prisma.user.findUnique({ where: { email: IDENTITY_EMAIL } });
  if (user && user.role !== "ai_agent") {
    die(`A user with ${IDENTITY_EMAIL} exists but its role is "${user.role}". Refusing to touch it.`);
  }
  let createdUser = false;
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: IDENTITY_EMAIL,
        name: IDENTITY_NAME,
        role: "ai_agent",
        passwordHash: DISABLED_PASSWORD_HASH,
        approvalStatus: "approved",
        isActive: true,
      },
    });
    createdUser = true;
  }
  let identity = await prisma.agentIdentity.findUnique({ where: { userId: user.id } });
  let createdIdentity = false;
  if (!identity) {
    identity = await prisma.agentIdentity.create({
      data: { userId: user.id, name: IDENTITY_NAME, status: "active" },
    });
    createdIdentity = true;
  }
  console.log(
    `Service user ${createdUser ? "created" : "already existed"} (id ${user.id}); ` +
      `identity ${createdIdentity ? "created" : "already existed"} (id ${identity.id}, status ${identity.status}).`,
  );
}

async function issue(prisma: PrismaClient, flags: Flags) {
  const env = parseEnv(need(flags, "env"));
  if (env === "production" && !one(flags, "allow-production")) {
    die("Issuing a production key needs an extra --allow-production flag.");
  }
  const label = need(flags, "label");
  const ips = parseIps(flags);
  const expiresAt = parseExpiry(flags);
  const out = resolveOut(flags);
  const identity = await requireIdentity(prisma);

  const { key, keyId, secretHash } = generateKey(env);
  writeKeyFile(out, key);
  try {
    await prisma.agentCredential.create({
      data: { identityId: identity.id, environment: env, keyId, secretHash, label, ipAllowlist: ips, expiresAt },
    });
  } catch (error) {
    unlinkSync(out);
    throw error;
  }
  console.log(`Issued key  ${keyPrefix(env, keyId)}  (${env}, label "${label}")`);
  console.log(`  expires:      ${fmt(expiresAt)}`);
  console.log(`  ip allowlist: ${ips.length ? ips.join(", ") : "(any)"}`);
  console.log(`  full key written to: ${out}   (never printed; only this file has it)`);
  console.log(`  ${pepperNote()}`);
}

async function rotate(prisma: PrismaClient, flags: Flags) {
  const oldKeyId = need(flags, "key-id");
  const out = resolveOut(flags);
  const expiresAt = parseExpiry(flags);
  const old = await prisma.agentCredential.findUnique({ where: { keyId: oldKeyId } });
  if (!old) die(`No credential with key id ${oldKeyId}.`);
  if (old.revokedAt) die(`Credential ${oldKeyId} is already revoked.`);
  const env = parseEnv(old.environment);

  const { key, keyId, secretHash } = generateKey(env);
  writeKeyFile(out, key);
  const graceEnds = new Date(Date.now() + DAY_MS);
  try {
    await prisma.$transaction([
      prisma.agentCredential.create({
        data: {
          identityId: old.identityId,
          environment: old.environment,
          keyId,
          secretHash,
          label: old.label,
          ipAllowlist: old.ipAllowlist ?? [],
          expiresAt,
          rotatedFromId: old.id,
        },
      }),
      prisma.agentCredential.update({
        where: { id: old.id },
        data: { expiresAt: old.expiresAt && old.expiresAt < graceEnds ? old.expiresAt : graceEnds },
      }),
    ]);
  } catch (error) {
    unlinkSync(out);
    throw error;
  }
  console.log(`Rotated  ${keyPrefix(env, oldKeyId)}  ->  ${keyPrefix(env, keyId)}`);
  console.log(`  old key keeps working until ${fmt(graceEnds)} (24 h), then expires.`);
  console.log(`  new key expires: ${fmt(expiresAt)}`);
  console.log(`  full key written to: ${out}   (never printed)`);
  console.log(`  ${pepperNote()}`);
}

async function revoke(prisma: PrismaClient, flags: Flags) {
  const keyId = need(flags, "key-id");
  const reason = need(flags, "reason");
  const result = await prisma.agentCredential.updateMany({
    where: { keyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  if (result.count === 0) die(`No active credential with key id ${keyId} (unknown, or already revoked).`);
  console.log(`Revoked ${keyId}. It stops working immediately.`);
}

async function list(prisma: PrismaClient) {
  const rows = await prisma.agentCredential.findMany({ orderBy: { createdAt: "desc" } });
  if (rows.length === 0) return console.log("No credentials.");
  console.table(
    rows.map((r) => ({
      keyId: r.keyId,
      env: r.environment,
      label: r.label,
      created: fmt(r.createdAt),
      lastUsed: fmt(r.lastUsedAt),
      expires: fmt(r.expiresAt),
      revoked: r.revokedAt ? `${fmt(r.revokedAt)} (${r.revokedReason ?? ""})` : "-",
    })),
  );
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const commands = ["create-identity", "issue", "rotate", "revoke", "list"];
  if (!command || !commands.includes(command)) {
    console.log(`Usage: npx tsx scripts/agent-keys.ts <${commands.join("|")}> [flags] --confirm-host <db-host>`);
    process.exit(command ? 1 : 0);
  }
  const prisma = await connect(flags);
  try {
    if (command === "create-identity") await createIdentity(prisma);
    else if (command === "issue") await issue(prisma, flags);
    else if (command === "rotate") await rotate(prisma, flags);
    else if (command === "revoke") await revoke(prisma, flags);
    else await list(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
