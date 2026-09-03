/**
 * **No score output may imply population, density or per-capita saturation.**
 *
 * Model v1.0 has no population data. `getCatchmentProfile()` returns
 * `{ available: false, reason: 'not_ingested' }` in every scan of this build,
 * so a report sentence containing "residents" or "per 100,000" would be a
 * number the system invented — and a land owner sizing a capital investment
 * against an invented population figure is the worst failure this project can
 * produce.
 *
 * This test walks **every string a `ScoreResult` can carry** — justifications,
 * flag messages, verdict statements, confidence reasons, part details, input
 * keys and string values — across every fixture scenario, and fails on any
 * banned term.
 *
 * ## Why the disclaimer text is not in here
 *
 * The sentence that *says* there is no population figure necessarily contains
 * the word. It lives in `@/lib/scout/census/disclosure`
 * (`POPULATION_LIMITATION_TEXT`), is rendered by the report and the API
 * response, and is deliberately never produced by the scoring module — which
 * is what lets this assertion be absolute rather than an allowlist somebody
 * later widens "just for this one string".
 */

import { describe, expect, it } from "vitest";

import { computeScore, SCORE_MODEL_V1, SURVEYOR_CHECKLIST } from "@/lib/scout/scoring";
import { GOLDEN_SCENARIOS } from "../../../../tests/fixtures/scoring";

/**
 * Whole-word patterns. `\bresidents?\b` deliberately does not match
 * "residences" — the checklist field *Adjacent residences* is an observation
 * about the plot's neighbours, not a claim about a catchment population.
 */
const BANNED: ReadonlyArray<{ pattern: RegExp; term: string }> = [
  { pattern: /\bpopulations?\b/i, term: "population" },
  { pattern: /\bpopulated\b/i, term: "populated" },
  { pattern: /\bresidents?\b/i, term: "resident(s)" },
  { pattern: /\bdensit(y|ies)\b/i, term: "density" },
  { pattern: /\bper[-\s]capita\b/i, term: "per capita" },
  { pattern: /\binhabitants?\b/i, term: "inhabitant(s)" },
  { pattern: /\bdemographics?\b/i, term: "demographic(s)" },
  { pattern: /\bcensus\b/i, term: "census" },
  { pattern: /\bper\s*100[,.]?000\b/i, term: "per 100,000" },
  { pattern: /\bpeople per\b/i, term: "people per" },
  { pattern: /\bcatchment size\b/i, term: "catchment size" },
  { pattern: /\bfootfall per\b/i, term: "footfall per" },
  { pattern: /\bper (?:km|square kilometre|sq km)\b/i, term: "per km²" },
];

/**
 * The plan excludes revenue projection outright, and the client's agreed
 * disclaimer says the report "contains no projection of revenue or return".
 * A verdict sentence drifting into a financial claim would contradict the
 * disclaimer printed on the same page.
 */
const BANNED_FINANCIAL: ReadonlyArray<{ pattern: RegExp; term: string }> = [
  { pattern: /\brevenues?\b/i, term: "revenue" },
  { pattern: /\bprofit(s|able|ability)?\b/i, term: "profit" },
  { pattern: /\broi\b/i, term: "ROI" },
  { pattern: /\bpayback\b/i, term: "payback" },
  { pattern: /\breturn on\b/i, term: "return on investment" },
  { pattern: /\bearnings?\b/i, term: "earnings" },
  { pattern: /\bturnover\b/i, term: "turnover" },
  { pattern: /\b(?:lakh|crore)s?\b/i, term: "lakh/crore" },
  { pattern: /[₹$]/, term: "a currency symbol" },
];

/** Every string reachable from a value, with the path that reached it. */
function walkStrings(value: unknown, path = "$"): Array<{ path: string; text: string }> {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => walkStrings(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [
      // Keys are printable too — a field called `populationDensity` would leak.
      { path: `${path}.<key>`, text: k },
      ...walkStrings(v, `${path}.${k}`),
    ]);
  }
  return [];
}

describe("no score output implies population", () => {
  const scenarios = Object.entries(GOLDEN_SCENARIOS);

  it.each(scenarios)("%s carries no population term", (_name, input) => {
    const result = computeScore(input, SCORE_MODEL_V1);
    for (const { path, text } of walkStrings(result)) {
      for (const { pattern, term } of BANNED) {
        expect(
          pattern.test(text),
          `ScoreResult${path} contains "${term}": ${JSON.stringify(text)}. ` +
            `Model v1.0 has no population data — see docs/PHASE-2-HANDOFF.md.`,
        ).toBe(false);
      }
    }
  });

  it.each(scenarios)("%s carries no financial claim", (_name, input) => {
    const result = computeScore(input, SCORE_MODEL_V1);
    for (const { path, text } of walkStrings(result)) {
      for (const { pattern, term } of BANNED_FINANCIAL) {
        expect(
          pattern.test(text),
          `ScoreResult${path} contains "${term}": ${JSON.stringify(text)}. ` +
            `Revenue projection is explicitly out of scope.`,
        ).toBe(false);
      }
    }
  });

  it("the saturation justification names weighted demand anchors as the denominator", () => {
    const result = computeScore(GOLDEN_SCENARIOS["dense-underserved"]!, SCORE_MODEL_V1);
    const saturation = result.components.find((c) => c.id === "competitive-saturation")!;
    expect(saturation.justification).toMatch(/weighted demand anchors/);
    expect(saturation.justification).toMatch(/one per/);
    // The benchmark's sample count is part of the claim, never implied.
    expect(saturation.justification).toMatch(/benchmark from 24 scans/);
    expect(saturation.inputs.anchorsPerFacility).toBeTypeOf("number");
  });

  it("the checklist labels a surveyor sees carry no population term either", () => {
    for (const field of SURVEYOR_CHECKLIST) {
      for (const text of [field.label, field.help, ...field.anchors]) {
        for (const { pattern, term } of BANNED) {
          expect(pattern.test(text), `Checklist field ${field.id} contains "${term}".`).toBe(false);
        }
      }
    }
  });
});
