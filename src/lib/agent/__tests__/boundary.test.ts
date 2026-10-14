import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The agent API key must open ONE door: the routes under src/app/api/agent/v1,
 * through withAgent(). These tests fail the build if anything else starts to
 * accept it.
 */
const ROOT = path.resolve(__dirname, "../../../..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".claude", ".vercel", "coverage", ".next-verify-temp"]);
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (CODE.test(name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const ALL = walk(ROOT).map((f) => ({ file: rel(f), text: readFileSync(f, "utf8") }));

const inAgentLib = (f: string) => f.startsWith("src/lib/agent/");
const inAgentApi = (f: string) => f.startsWith("src/app/api/agent/");

// Any way of reaching the verifier: its name, or importing keys.ts by path.
const VERIFIER_NAME = /\bverifyCredential\b/;
const KEYS_IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'][^"']*\bagent\/keys["']/;

describe("agent credential boundary", () => {
  it("found the source tree", () => {
    expect(ALL.length).toBeGreaterThan(200);
    expect(ALL.some((f) => f.file === "src/lib/agent/keys.ts")).toBe(true);
    expect(ALL.some((f) => f.file === "src/lib/auth.ts")).toBe(true);
  });

  it("no file outside src/lib/agent/** and src/app/api/agent/** touches the credential verifier", () => {
    const offenders = ALL.filter(
      ({ file, text }) => !inAgentLib(file) && !inAgentApi(file) && (VERIFIER_NAME.test(text) || KEYS_IMPORT.test(text)),
    ).map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("inside the agent code, only withAgent.ts (and keys.ts itself, and tests) uses the verifier", () => {
    const allowed = new Set(["src/lib/agent/keys.ts", "src/lib/agent/withAgent.ts"]);
    const offenders = ALL.filter(
      ({ file, text }) =>
        (inAgentLib(file) || inAgentApi(file)) &&
        !allowed.has(file) &&
        !file.includes("/__tests__/") &&
        (VERIFIER_NAME.test(text) || KEYS_IMPORT.test(text)),
    ).map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("the human auth path never looks at a Bearer key or an agent key", () => {
    for (const file of ["src/lib/auth.ts", "src/lib/session.ts", "src/middleware.ts", "src/lib/rbac.ts"]) {
      const text = ALL.find((f) => f.file === file)!.text;
      expect(text, file).not.toMatch(/bearer/i);
      expect(text, file).not.toMatch(/fvai_/);
      expect(text, file).not.toMatch(/authorization/i);
      expect(text, file).not.toMatch(/lib\/agent/);
    }
  });

  it("the middleware matcher does not cover the agent API", () => {
    const text = ALL.find((f) => f.file === "src/middleware.ts")!.text;
    expect(text).not.toMatch(/api\/agent/);
    expect(text).not.toMatch(/\|api\|/);
  });

  it("every agent route that is not public goes through withAgent", () => {
    const routes = ALL.filter((f) => f.file.startsWith("src/app/api/agent/v1/") && /\/route\.ts$/.test(f.file));
    expect(routes.length).toBeGreaterThanOrEqual(3);
    const PUBLIC = new Set([
      "src/app/api/agent/v1/health/route.ts",
      "src/app/api/agent/v1/openapi.json/route.ts",
      // Unknown-address catch-all: only ever answers a JSON 404, reveals nothing.
      "src/app/api/agent/v1/[...slug]/route.ts",
    ]);
    for (const r of routes) {
      if (PUBLIC.has(r.file)) continue;
      expect(r.text, r.file).toMatch(/withAgent\(/);
    }
  });

  it("the agent role is excluded from every human privilege helper", async () => {
    const rbac = await import("@/lib/rbac");
    for (const fn of [rbac.isAdmin, rbac.isManagerOrAbove, rbac.isManagementOrAbove, rbac.canSeeAllCustomers, rbac.canManageAllCustomers]) {
      expect(fn("ai_agent")).toBe(false);
    }
    expect(rbac.customerAccess({ id: "agent", role: "ai_agent" }, "someone-else")).toEqual({ canView: false, canEdit: false });
    expect(rbac.isAgentRole("ai_agent")).toBe(true);
  });
});
