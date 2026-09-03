/**
 * The comparison report — D4's table, as a document.
 *
 * The table, the warnings and the narrative all come from `buildComparison`,
 * unchanged. That is the point: the paragraph a customer reads on paper and the
 * paragraph the salesperson read on screen are produced by the same pure
 * function from the same numbers, so they cannot drift into disagreeing.
 *
 * ## The warnings go first, not last
 *
 * A side-by-side table is the easiest place in this whole product to mislead
 * somebody, and every way it does so is silent: a 5 km scan finds more of
 * everything than a 2 km one; a column that never searched for pickleball shows
 * zero pickleball courts; a desk-only score is rescaled to 100 without the
 * survey component and can out-rank a surveyed site for that reason alone.
 * `buildComparison` raises a coded warning for each. They are printed **above**
 * the table, at full weight, because a caveat underneath a table is a caveat
 * the reader meets after they have already drawn their conclusion.
 */

import { POPULATION_LIMITATION_TEXT } from "@/lib/scout/census/disclosure";
import type { ComparisonModel } from "@/lib/scout/compare/model";
import { formatFullDate, formatRadius } from "@/lib/scout/display/format";

import { reportBrand, type ReportBrand } from "./brand";
import { renderStaticMarkup } from "./staticMarkup";
import { REPORT_FONT_LINK, reportCss } from "./css";

/**
 * What the comparison says it does not cover.
 *
 * Exported for the same reason `REPORT_LIMITATION_BULLETS` is: this is one of
 * the few places the words *revenue*, *return* and *payback* are allowed to
 * appear, as a denial. `reportContent.test.ts` removes these exact strings
 * before scanning the rendered HTML, so the ban everywhere else stays absolute
 * rather than becoming a widening regex.
 */
export const COMPARISON_LIMITATION_BULLETS: readonly string[] = [
  "Anything the individual scan reports cover in detail — competitor quality, complaint themes, operating windows and the surveyor’s observations. This document is the table, not the argument.",
  "Land ownership, title, price, zoning or tenure in any of the areas.",
  "Any projection of revenue, return or payback for any of them.",
];

export interface ComparisonReportMeta {
  readonly preparedBy: string;
  readonly customerName: string | null;
  /** ISO-8601, supplied by the caller so the output is clock-independent. */
  readonly generatedAt: string;
  readonly version: number;
}

export interface ComparisonDocument {
  readonly title: string;
  readonly meta: ComparisonReportMeta;
  readonly generatedAtLabel: string;
  readonly comparison: ComparisonModel;
  readonly brand: ReportBrand;
  /** True when nothing in the table may be ranked without a caveat. */
  readonly rankingIsUnsafe: boolean;
}

/** Warning codes that make a straight ranking of the columns misleading. */
export const RANKING_UNSAFE_CODES: readonly string[] = [
  "compare_radius_mismatch",
  "compare_terms_mismatch",
  "compare_mixed_score_basis",
];

export function buildComparisonDocument(
  comparison: ComparisonModel,
  meta: ComparisonReportMeta,
  brand: ReportBrand = reportBrand(),
): ComparisonDocument {
  const areas = comparison.subjects.map((s) => s.areaLabel);
  return {
    title:
      areas.length > 0
        ? `${areas.join(" vs ")} — Site Scout comparison`
        : "Site Scout comparison",
    meta,
    generatedAtLabel: formatFullDate(meta.generatedAt),
    comparison,
    brand,
    rankingIsUnsafe: comparison.warnings.some((w) => RANKING_UNSAFE_CODES.includes(w.code)),
  };
}

/* --------------------------------------------------------------- render */

function ComparisonBody({ doc }: { doc: ComparisonDocument }) {
  const { comparison } = doc;
  const warnings = comparison.warnings.filter((w) => w.severity === "warning");
  const notes = comparison.warnings.filter((w) => w.severity === "info");

  return (
    <div className="page">
      <section className="section">
        <div className="coverHead">
          <span className="mark" />
          <span className="wordmark">Site Scout comparison</span>
        </div>

        <div className="coverMeta">
          <h1>{comparison.subjects.map((s) => s.areaLabel).join(" · ")}</h1>
        </div>

        <div className="coverMeta">
          <dl>
            {comparison.subjects.map((subject) => (
              <div key={subject.scanId} style={{ display: "contents" }}>
                <dt>{subject.areaLabel}</dt>
                <dd>
                  {formatRadius(subject.radiusM)} radius ·{" "}
                  {subject.score
                    ? `score ${Math.round(subject.score.total)}${subject.score.basis === "desk_only" ? " (desk only)" : ""}`
                    : "not scored"}
                </dd>
              </div>
            ))}
            {doc.meta.customerName ? (
              <>
                <dt>Prepared for</dt>
                <dd>{doc.meta.customerName}</dd>
              </>
            ) : null}
            <dt>Prepared by</dt>
            <dd>{doc.meta.preparedBy}</dd>
            <dt>Issued</dt>
            <dd>{doc.generatedAtLabel}</dd>
          </dl>
        </div>

        {warnings.length > 0 ? (
          <>
            <h3>Read these before the table</h3>
            {warnings.map((warning) => (
              <div key={warning.code} className="callout warn">
                <p>{warning.message}</p>
              </div>
            ))}
          </>
        ) : (
          <div className="callout note">
            <p>
              These scans used the same radius and the same categories, and their scores rest on the
              same basis, so the columns below are directly comparable.
            </p>
          </div>
        )}

        {doc.rankingIsUnsafe ? (
          <div className="callout amber">
            <span className="h">Do not rank these columns as they stand</span>
            <p>
              At least one difference above changes what the numbers mean. Re-run the scans on the
              same radius and the same categories, and survey every site, before treating this table
              as a ranking.
            </p>
          </div>
        ) : null}
      </section>

      <section className="section">
        <h2>
          <span className="sectionNo">1. </span>Side by side
        </h2>
        <table>
          <thead>
            <tr>
              <th>Measure</th>
              {comparison.subjects.map((subject) => (
                <th key={subject.scanId} className="r">
                  {subject.areaLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.label}
                  {row.note ? <div className="tiny">{row.note}</div> : null}
                </td>
                {row.values.map((value, index) => (
                  <td key={`${row.id}:${index}`} className="r">
                    {value.display}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tableNote">
          Counts are of Google-listed places only. A dash means that scan did not search for the
          category — it does not mean none was found.
        </p>
      </section>

      <section className="section">
        <h2>
          <span className="sectionNo">2. </span>Read
        </h2>
        {comparison.narrative.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}

        {notes.length > 0 ? (
          <>
            <h3>Worth knowing</h3>
            <ul className="small">
              {notes.map((note) => (
                <li key={note.code}>{note.message}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className="section">
        <h2>
          <span className="sectionNo">3. </span>What this comparison does not cover
        </h2>
        <p className="small">{POPULATION_LIMITATION_TEXT}</p>
        <ul className="small">
          {COMPARISON_LIMITATION_BULLETS.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>

        <div className="endMatter">
          <p className="disclaimer">{doc.brand.disclaimer}</p>
          <p className="tiny">{doc.brand.attribution}</p>
          <p className="tiny">
            {doc.brand.legalName}
            {doc.brand.contactLines.length > 0 ? ` · ${doc.brand.contactLines.join(" · ")}` : ""}
          </p>
        </div>
      </section>
    </div>
  );
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function renderComparisonHtml(doc: ComparisonDocument): Promise<string> {
  const body = await renderStaticMarkup(<ComparisonBody doc={doc} />);
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeText(doc.title)}</title>`,
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
    `<link rel="stylesheet" href="${REPORT_FONT_LINK}">`,
    `<style>${reportCss()}</style>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("\n");
}
