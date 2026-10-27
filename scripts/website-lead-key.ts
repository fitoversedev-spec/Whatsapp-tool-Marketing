// Operator tool for the secret that protects POST /api/website-leads/incoming
// (the webhook the Fitoverse website sends its "Build a court" leads to).
//
//   npx tsx scripts/website-lead-key.ts issue --base-url https://crm.example.com --out <file> --confirm-host <db-host>
//   npx tsx scripts/website-lead-key.ts status --confirm-host <db-host>
//   npx tsx scripts/website-lead-key.ts revoke --confirm-host <db-host>
//
// `issue` makes a new secret, stores ONLY its sha256 hash (Setting key
// website_lead_webhook_key_hash) and writes the full webhook URL
//   <base-url>/api/website-leads/incoming?key=<secret>
// to the --out file. Set that URL as LEAD_WEBHOOK_URL on the website. Issuing
// again replaces the secret: the old URL stops working at once. `revoke` removes
// the hash, so the webhook accepts nothing until a new one is issued.
//
// SAFETY (same as scripts/agent-keys.ts)
//  * This script does not load .env files (no dotenv). DATABASE_URL must be
//    exported in the shell you run it from. It is checked BEFORE @prisma/client is
//    even imported (Prisma would otherwise pull one in from a .env file), and
//    passed to the client explicitly, so the script can only touch a database you
//    named.
//  * It prints the database host and refuses to continue unless you pass the
//    same host as --confirm-host.
//  * The URL (which holds the secret) is written ONLY to the file named by --out
//    (created exclusively, owner-readable, refused inside the repository) and is
//    never printed.

import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
// Type-only: the real @prisma/client is imported dynamically in connect(), AFTER the
// DATABASE_URL check (importing it first would let Prisma load a .env file).
import type { PrismaClient } from "@prisma/client";
import {
  WEBSITE_LEAD_INCOMING_PATH,
  WEBSITE_LEAD_KEY_SETTING,
  generateWebsiteLeadKey,
  hashWebsiteLeadKey,
} from "../src/lib/website-leads/key";

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

/** The CRM's public address, e.g. https://crm.example.com (http only for localhost). */
function parseBaseUrl(flags: Flags): string {
  const raw = need(flags, "base-url");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    die(`--base-url "${raw}" is not a valid URL (expected something like https://crm.example.com).`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    die("--base-url must be https:// (the secret travels in the URL). http:// is only allowed for localhost.");
  }
  return url.origin;
}

/** Resolve --out; never inside the repository (a file there could be committed). */
function resolveOut(flags: Flags): string {
  const out = path.resolve(need(flags, "out"));
  const rel = path.relative(process.cwd(), out);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    die(`Refusing to write the URL file inside the repository (${out}). Choose a path outside it.`);
  }
  if (existsSync(out)) die(`${out} already exists. Choose a new path; existing files are never overwritten.`);
  return out;
}

const fmt = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + "Z" : "-");

// ---- commands --------------------------------------------------------------

async function issue(prisma: PrismaClient, flags: Flags) {
  const baseUrl = parseBaseUrl(flags);
  const out = resolveOut(flags);

  const key = generateWebsiteLeadKey();
  const webhookUrl = `${baseUrl}${WEBSITE_LEAD_INCOMING_PATH}?key=${key}`;
  writeFileSync(out, `${webhookUrl}\n`, { flag: "wx", mode: 0o600 });

  const previous = await prisma.setting.findUnique({ where: { key: WEBSITE_LEAD_KEY_SETTING } });
  try {
    const value = hashWebsiteLeadKey(key);
    await prisma.setting.upsert({
      where: { key: WEBSITE_LEAD_KEY_SETTING },
      create: { key: WEBSITE_LEAD_KEY_SETTING, value },
      update: { value },
    });
  } catch (error) {
    unlinkSync(out);
    throw error;
  }
  console.log(previous ? "Issued a new webhook secret (the previous one no longer works)." : "Issued the webhook secret.");
  console.log(`  webhook URL written to: ${out}   (never printed; only this file has it)`);
  console.log("  Set that URL as LEAD_WEBHOOK_URL on the website, then redeploy it.");
}

async function status(prisma: PrismaClient) {
  const row = await prisma.setting.findUnique({ where: { key: WEBSITE_LEAD_KEY_SETTING } });
  console.log(
    row
      ? `A webhook secret is set (hash stored, last changed ${fmt(row.updatedAt)}).`
      : "No webhook secret is set: /api/website-leads/incoming rejects every request.",
  );
}

async function revoke(prisma: PrismaClient) {
  const res = await prisma.setting.deleteMany({ where: { key: WEBSITE_LEAD_KEY_SETTING } });
  console.log(
    res.count > 0
      ? "Revoked. The webhook now rejects every request until a new secret is issued."
      : "There was no webhook secret to revoke.",
  );
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const commands = ["issue", "status", "revoke"];
  if (!command || !commands.includes(command)) {
    console.log(
      `Usage: npx tsx scripts/website-lead-key.ts <${commands.join("|")}> [flags] --confirm-host <db-host>\n` +
        "  issue --base-url https://<crm-address> --out <file outside the repo>",
    );
    process.exit(command ? 1 : 0);
  }
  // Check the flags before touching the database.
  if (command === "issue") {
    parseBaseUrl(flags);
    resolveOut(flags);
  }
  const prisma = await connect(flags);
  try {
    if (command === "issue") await issue(prisma, flags);
    else if (command === "status") await status(prisma);
    else await revoke(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
