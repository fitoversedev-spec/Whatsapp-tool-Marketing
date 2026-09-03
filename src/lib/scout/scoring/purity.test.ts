/**
 * The scoring module is pure, and this test is what keeps it that way.
 *
 * A score has to be reproducible from its inputs and its model version alone.
 * The moment `src/lib/scoring/**` can reach a database, a network or a clock,
 * that stops being true — a report regenerated next year would re-score
 * against whatever the world looks like then, and nobody would notice until a
 * customer asked why their number changed.
 *
 * So this walks the directory and fails on any forbidden import. It is
 * deliberately a source-level check rather than a mocking exercise: the point
 * is that the dependency cannot exist, not that it happens not to fire.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/** Import specifiers that would make scoring impure. */
const FORBIDDEN_IMPORTS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /^server-only$/, why: "server-only marks a module as unusable in a pure context" },
  { pattern: /^pg$/, why: "a database driver" },
  { pattern: /^@prisma\/client/, why: "a database query builder" },
  { pattern: /^@prisma\/adapter-/, why: "a database driver adapter" },
  { pattern: /^@\/db/, why: "the application database" },
  { pattern: /^next(\/|$)/, why: "a framework import" },
  { pattern: /^react(-dom)?(\/|$)/, why: "a framework import" },
  { pattern: /^@anthropic-ai\//, why: "a network client" },
  { pattern: /^node:(fs|http|https|net|dns|child_process)/, why: "I/O" },
  { pattern: /^@\/lib\/(places|census|benchmarks|auth|env)/, why: "a server-side module" },
];

/** Globals that would make scoring non-reproducible. */
const FORBIDDEN_GLOBALS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /\bDate\.now\s*\(/, why: "a clock makes the same input score differently over time" },
  { pattern: /\bnew Date\s*\(\s*\)/, why: "a clock makes the same input score differently over time" },
  { pattern: /\bMath\.random\s*\(/, why: "randomness makes a score irreproducible" },
  { pattern: /\bfetch\s*\(/, why: "a network call" },
  { pattern: /\bprocess\.env\b/, why: "environment configuration belongs in the score model row" },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
    out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;
const REQUIRE_RE = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

describe("scoring module purity", () => {
  const files = sourceFiles(here);

  it("finds the module's source files", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(files.map((f) => [f.slice(here.length + 1), f] as const))(
    "%s imports nothing impure",
    (_name, file) => {
      const source = readFileSync(file, "utf8");
      const specifiers: string[] = [];
      for (const re of [IMPORT_RE, REQUIRE_RE, DYNAMIC_IMPORT_RE]) {
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(source)) !== null) specifiers.push(match[1]!);
      }

      for (const specifier of specifiers) {
        for (const { pattern, why } of FORBIDDEN_IMPORTS) {
          expect(
            pattern.test(specifier),
            `${file} imports "${specifier}" — ${why}. Move this code to src/lib/siteScore/ instead.`,
          ).toBe(false);
        }
      }
    },
  );

  it.each(files.map((f) => [f.slice(here.length + 1), f] as const))(
    "%s uses no impure global",
    (_name, file) => {
      const source = stripComments(readFileSync(file, "utf8"));
      for (const { pattern, why } of FORBIDDEN_GLOBALS) {
        expect(pattern.test(source), `${file} uses ${pattern} — ${why}.`).toBe(false);
      }
    },
  );
});

/** Comments mention `Date.now` and `fetch` legitimately; code must not use them. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
