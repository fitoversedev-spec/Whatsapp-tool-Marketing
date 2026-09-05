/**
 * The report renderer — server-rendered React → one self-contained HTML
 * document.
 *
 * React rather than string concatenation because escaping is then not a thing
 * anyone has to remember: a competitor called `Smash & Volley <Indiranagar>`
 * and a verbatim review quote containing an angle bracket both come out of the
 * scan as untrusted text, and `renderToStaticMarkup` escapes every one of them
 * without a call site having to opt in. v16 hand-rolled `esc()` and called it
 * on most, but not all, of its interpolations.
 *
 * `renderToStaticMarkup` specifically — not `renderToString`. Hydration markers
 * would be dead weight in a document nobody hydrates, and they would make the
 * golden files churn on a React upgrade for no reason.
 *
 * The output is deliberately dependency-free: no script, no external CSS, and
 * the only remote request is the Google Fonts stylesheet (see `css.ts`). Drop
 * that link and the document still renders, in the fallback faces.
 */

import { REPORT_FONT_LINK, reportCss } from "./css";
import { FITOVERSE_LOGO_DATA_URI } from "./logo-data";
import { renderStaticMarkup } from "./staticMarkup";
import { REPORT_SECTION_TITLES, type ReportDocument, type ReportSectionId } from "./types";

/* ----------------------------------------------------------- small parts */

function SectionHeading({ n, id }: { n: number; id: ReportSectionId }) {
  return (
    <h2>
      <span className="sectionNo">{n}. </span>
      {REPORT_SECTION_TITLES[id]}
    </h2>
  );
}

function Callout({
  tone = "note",
  heading,
  children,
}: {
  tone?: "note" | "warn" | "amber" | "plain";
  heading?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={tone === "plain" ? "callout" : `callout ${tone}`}>
      {heading ? <span className="h">{heading}</span> : null}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ cover */

function Cover({ doc }: { doc: ReportDocument }) {
  const { meta, cover, footer } = doc;
  return (
    <section className="section">
      <div className="coverHead">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={FITOVERSE_LOGO_DATA_URI} alt="Fitoverse" className="coverLogo" />
        <span className="wordmark">Site Scout report</span>
      </div>

      <div className="coverMeta">
        <div className="eyebrow">Area</div>
        <h1 style={{ marginTop: "6pt" }}>{cover.headline}</h1>
      </div>

      {cover.verdictLabel && cover.scoreLine ? (
        <div className="verdictStrip">
          <div className="score">{cover.scoreLine.split(" ")[0]}</div>
          <div className="of">{cover.scoreLine.replace(/^\S+\s/, "")}</div>
          <div className="badgeRow">
            <span className={`badge ${cover.verdictTone ?? "blue"}`}>{cover.verdictLabel}</span>
            {cover.basisLabel ? (
              <span className="badge amber" style={{ marginLeft: "6pt" }}>
                Desk only
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="coverMeta">
        <dl>
          <dt>Radius</dt>
          <dd>{meta.radiusLabel}</dd>
          {meta.address ? (
            <>
              <dt>Site</dt>
              <dd>{meta.address}</dd>
            </>
          ) : null}
          <dt>Coordinates</dt>
          <dd>
            {meta.centre.lat.toFixed(6)}, {meta.centre.lng.toFixed(6)}
          </dd>
          {meta.customerName ? (
            <>
              <dt>Prepared for</dt>
              <dd>{meta.customerName}</dd>
            </>
          ) : null}
          <dt>Prepared by</dt>
          <dd>{meta.preparedBy}</dd>
          <dt>Issued</dt>
          <dd>{meta.generatedAtLabel}</dd>
          {meta.dataCollectedAtLabel ? (
            <>
              <dt>Data collected</dt>
              <dd>{meta.dataCollectedAtLabel}</dd>
            </>
          ) : null}
          <dt>Version</dt>
          <dd>
            v{meta.version}
            {meta.scoreModelVersion ? ` · score model v${meta.scoreModelVersion}` : ""}
          </dd>
        </dl>
      </div>

      {cover.stats ? (
        <div className="stats">
          {cover.stats.map((stat) => (
            <div key={stat.label} className={stat.emphasis ? "stat dark" : "stat"}>
              <div className="v">{stat.value}</div>
              <div className="l">{stat.label}</div>
              {stat.note ? <div className="n">{stat.note}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      <p className="small">{cover.summarySentence}</p>

      {meta.countsAreFloors ? (
        <Callout tone="amber" heading="Counts on this report are floors">
          <p>
            At least one search returned the maximum number of results a single query can, so the
            affected counts read “at least N”. They must not be quoted as a complete count.
          </p>
        </Callout>
      ) : null}

      <p className="disclaimer endMatter">{footer.disclaimer}</p>
    </section>
  );
}

/* ---------------------------------------------------------------- verdict */

function Verdict({ doc, n }: { doc: ReportDocument; n: number }) {
  const v = doc.verdict;
  if (!v) return null;
  return (
    <section className="section">
      <SectionHeading n={n} id="verdict" />

      <div className="verdictStrip">
        <div className="score">{v.total}</div>
        <div className="of">{v.outOf}</div>
        <div className="badgeRow">
          <span className={`badge ${v.verdictTone}`}>{v.verdictLabel}</span>
          <span className="badge blue" style={{ marginLeft: "6pt" }}>
            {v.confidenceLabel}
          </span>
        </div>
      </div>

      <p>{v.statement}</p>

      {v.basisLabel ? (
        <Callout tone="amber" heading={v.basisLabel}>
          <p>
            The site-practicals component was excluded from both the numerator and the denominator,
            and the remaining points were rescaled to 100. A score produced this way is not
            comparable with one from a surveyed site.
          </p>
        </Callout>
      ) : null}

      {v.hardFlags.length > 0 ? (
        <Callout tone="warn" heading="Reported whatever the total says">
          {v.hardFlags.map((flag) => (
            <p key={flag.code}>{flag.message}</p>
          ))}
        </Callout>
      ) : null}

      <h3>The five components</h3>
      {v.components.map((component) => (
        <div key={component.id} className="component">
          <div className="componentHead">
            <span className="name">{component.label}</span>
            <span className="pts">{component.points}</span>
          </div>
          {component.fraction === null ? (
            <div className="bar excluded" />
          ) : (
            <div className="bar">
              <i style={{ width: `${Math.round(component.fraction * 100)}%` }} />
            </div>
          )}
          <p className="justification">{component.justification}</p>
          {component.parts.length > 0 ? (
            <ul className="parts">
              {component.parts.map((part) => (
                <li key={part.label}>
                  <strong>{part.label}</strong> — {part.detail}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}

      <h3>Confidence</h3>
      <p className="small">
        {v.confidenceLabel}. {v.modelVersionLine}
      </p>
      {v.confidenceReasons.length > 0 ? (
        <ul className="small">
          {v.confidenceReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {v.otherFlags.length > 0 ? (
        <>
          <h3>Other findings the score recorded</h3>
          <ul className="small">
            {v.otherFlags.map((flag) => (
              <li key={flag.code}>{flag.message}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------- catchment */

function Catchment({ doc, n }: { doc: ReportDocument; n: number }) {
  const c = doc.catchment;
  return (
    <section className="section">
      <SectionHeading n={n} id="catchment" />
      <p className="small">
        {c.radiusLine} {c.areaLine}
      </p>

      {c.saturation ? (
        <>
          <h3>Competitive saturation</h3>
          <p>
            <strong>{c.saturation.figure}</strong>
          </p>
          {c.saturation.benchmark ? <p className="small">{c.saturation.benchmark}</p> : null}
          <p className="small">
            <strong>{c.saturation.sampleLine}</strong>
          </p>
          {c.saturation.standing ? <p className="small">{c.saturation.standing}</p> : null}
          <Callout tone="note">
            <p>{c.saturation.methodNote}</p>
          </Callout>
          <p className="small">{c.saturation.justification}</p>
        </>
      ) : null}

      {c.anchors.length > 0 ? (
        <>
          <h3>Demand anchors by category</h3>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th className="r">Count</th>
                <th className="r">Nearest</th>
              </tr>
            </thead>
            <tbody>
              {c.anchors.map((row) => (
                <tr key={row.label}>
                  <td>
                    {row.label}
                    {row.nearestName ? (
                      <div className="tiny">Nearest: {row.nearestName}</div>
                    ) : null}
                  </td>
                  <td className="r">{row.count}</td>
                  <td className="r">{row.nearestDistance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {c.observations.length > 0 ? (
        <>
          <h3>Read from the data</h3>
          <ul>
            {c.observations.map((observation) => (
              <li key={observation}>{observation}</li>
            ))}
          </ul>
          <p className="tiny">{c.observationsNote}</p>
        </>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------ competition */

function Competition({ doc, n }: { doc: ReportDocument; n: number }) {
  const c = doc.competition;
  return (
    <section className="section">
      <SectionHeading n={n} id="competition" />
      <p>
        <strong>{c.headline}</strong>
      </p>
      <Callout tone="note">
        <p>{c.caveat}</p>
      </Callout>

      {c.categories.map((category) => (
        <div key={category.categoryId}>
          <h3>{category.label}</h3>
          <p className="tiny">{category.countLine}</p>
          {category.rows.length === 0 ? (
            <p className="small muted">Nothing Google-listed in this category inside the radius.</p>
          ) : (
            category.rows.map((row) => (
              <div key={`${category.categoryId}:${row.name}:${row.distance}`} className="venue">
                <div className="venueTop">
                  <span className="venueName">{row.name}</span>
                  <span className="venueDist">{row.distance}</span>
                </div>
                <div className="venueMeta">
                  <span>{row.rating} ★</span>
                  <span>{row.reviews} reviews</span>
                  <span>{row.window}</span>
                  <span>{row.priceTier}</span>
                </div>
              </div>
            ))
          )}
          {category.overflow > 0 ? (
            <p className="tiny">
              {category.overflow} further {category.label.toLowerCase()} inside the radius are not
              listed here; the full set is in the scan.
            </p>
          ) : null}
        </div>
      ))}

      <h3>What customers complain about</h3>
      <p className="small">{c.themeState}</p>
      {c.themes.map((theme) => (
        <div key={theme.theme} className="theme">
          <div className="themeHead">
            <span className="n">{theme.label}</span>
            <span className="num">
              {theme.venueCount} {theme.venueCount === 1 ? "venue" : "venues"}
            </span>
          </div>
          <p className="tiny">{theme.summary}</p>
          {theme.quotes.map((quote) => (
            <blockquote key={`${theme.theme}:${quote.venue}:${quote.quote}`} className="quote">
              “{quote.quote}”<span className="src">Google review · {quote.venue}</span>
            </blockquote>
          ))}
        </div>
      ))}
    </section>
  );
}

/* ----------------------------------------------------------------- demand */

function Demand({ doc, n }: { doc: ReportDocument; n: number }) {
  const d = doc.demand;
  return (
    <section className="section">
      <SectionHeading n={n} id="demand" />
      <p>
        <strong>{d.headline}</strong>
      </p>

      {d.rows.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th className="r">Count</th>
              <th className="r">Nearest</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((row) => (
              <tr key={row.label}>
                <td>
                  {row.label}
                  {row.nearestName ? <div className="tiny">{row.nearestName}</div> : null}
                </td>
                <td className="r">{row.count}</td>
                <td className="r">{row.nearestDistance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="small muted">No demand categories were searched for in this scan.</p>
      )}
      <p className="tableNote">{d.distanceNote}</p>

      {d.countTable ? (
        <>
          <h3>Count summary</h3>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Side</th>
                <th className="r">Count</th>
                <th className="r">Reviews</th>
                <th className="r">Nearest</th>
              </tr>
            </thead>
            <tbody>
              {d.countTable.map((row) => (
                <tr key={`${row.side}:${row.label}`}>
                  <td>{row.label}</td>
                  <td className="tiny">{row.side}</td>
                  <td className="r">{row.count}</td>
                  <td className="r">{row.reviews}</td>
                  <td className="r">{row.nearest}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------- sportsAreas */

function SportsAreas({ doc, n }: { doc: ReportDocument; n: number }) {
  const s = doc.sportsAreas;
  if (!s) return null;
  return (
    <section className="section">
      <SectionHeading n={n} id="sportsAreas" />
      <p>
        <strong>{s.headline}</strong>
      </p>
      <table>
        <thead>
          <tr>
            <th>Facility</th>
            <th>Category</th>
            <th className="r">Distance</th>
            <th className="r">Rating</th>
            <th className="r">Reviews</th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map((row) => (
            <tr key={`${row.name}:${row.distance}`}>
              <td className="venueName">{row.name}</td>
              <td className="tiny">{row.category}</td>
              <td className="r">{row.distance}</td>
              <td className="r">{row.rating} ★</td>
              <td className="r">{row.reviews}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* -------------------------------------------------------------- aiSummary */

function AiSummary({ doc, n }: { doc: ReportDocument; n: number }) {
  const a = doc.aiSummary;
  if (!a) return null;
  return (
    <section className="section">
      <SectionHeading n={n} id="aiSummary" />
      <div className="aiSummaryBlock">{a.summary}</div>
    </section>
  );
}

/* ----------------------------------------------------------- suggestions */

function Suggestions({ doc, n }: { doc: ReportDocument; n: number }) {
  const s = doc.suggestions;
  if (!s) return null;
  return (
    <section className="section">
      <SectionHeading n={n} id="suggestions" />
      <div className="suggestionsBlock">{s.text}</div>
    </section>
  );
}

/* -------------------------------------------------------------------- map */

function MapPage({ doc, n }: { doc: ReportDocument; n: number }) {
  const m = doc.map;
  if (!m) return null;
  return (
    <section className="section">
      <SectionHeading n={n} id="map" />
      <div className="mapFrame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.url} alt={m.alt} />
      </div>
      <p className="tiny">{m.attribution}</p>
      <ul className="small">
        {m.legend.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ sweep */

function Sweep({ doc, n }: { doc: ReportDocument; n: number }) {
  const s = doc.sweep;
  if (!s) return null;
  return (
    <section className="section">
      <SectionHeading n={n} id="sweep" />
      <p className="small">{s.summary}</p>
      <table>
        <thead>
          <tr>
            <th>Cell</th>
            <th>Marked as</th>
            <th>Note</th>
            <th>Coordinates</th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map((row) => (
            <tr key={row.id}>
              <td className="num">{row.id}</td>
              <td>{row.status}</td>
              <td>{row.note}</td>
              <td className="tiny">{row.coordinates}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Callout tone="amber">
        <p>{s.caveat}</p>
      </Callout>
    </section>
  );
}

/* ----------------------------------------------------------- observations */

function Observations({ doc, n }: { doc: ReportDocument; n: number }) {
  const o = doc.observations;
  if (!o) return null;
  return (
    <section className="section">
      <SectionHeading n={n} id="observations" />
      <p className="tiny">{o.answeredLine}</p>

      {o.hardFlagNote ? (
        <Callout tone="warn" heading="Recorded regardless of the score">
          <p>{o.hardFlagNote}</p>
        </Callout>
      ) : null}

      {o.groups.map((group) => (
        <div key={group.label}>
          <h3>{group.label}</h3>
          <table>
            <thead>
              <tr>
                <th>Observation</th>
                <th className="r">Rating</th>
              </tr>
            </thead>
            <tbody>
              {group.fields.map((field) => (
                <tr key={field.label}>
                  <td>
                    {field.label}
                    <div className="tiny">{field.anchor}</div>
                  </td>
                  <td className="r num">{field.rating}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {o.fieldNotes ? (
        <>
          <h3>Field notes</h3>
          <div className="fieldNotes">{o.fieldNotes}</div>
        </>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------ limitations */

function Limitations({ doc, n }: { doc: ReportDocument; n: number }) {
  const l = doc.limitations;
  return (
    <section className="section">
      <SectionHeading n={n} id="limitations" />
      {l.paragraphs.map((paragraph) => (
        <p key={paragraph} className="small">
          {paragraph}
        </p>
      ))}
      <h3>Not covered by this assessment</h3>
      <ul className="small">
        {l.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>

      <div className="endMatter">
        <p className="disclaimer">{doc.footer.disclaimer}</p>
        <p className="tiny">{doc.footer.attribution}</p>
        <p className="tiny">
          {doc.footer.legalName}
          {doc.footer.lines.length > 0 ? ` · ${doc.footer.lines.join(" · ")}` : ""}
        </p>
        <p className="tiny">
          Report v{doc.meta.version} · scan {doc.meta.scanId}
          {doc.meta.scoreModelVersion ? ` · score model v${doc.meta.scoreModelVersion}` : ""} ·
          issued {doc.meta.generatedAtLabel}
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ body */

export function ReportBody({ doc }: { doc: ReportDocument }) {
  /**
   * The cover is the title page and carries no number, so the numbered
   * sequence starts at the verdict. A document whose first visible heading is
   * "2." reads like a page went missing.
   */
  let n = 0;
  return (
    <div className="page">
      {doc.sections.map((id) => {
        if (id !== "cover") n += 1;
        switch (id) {
          case "cover":
            return <Cover key={id} doc={doc} />;
          case "verdict":
            return <Verdict key={id} doc={doc} n={n} />;
          case "catchment":
            return <Catchment key={id} doc={doc} n={n} />;
          case "competition":
            return <Competition key={id} doc={doc} n={n} />;
          case "demand":
            return <Demand key={id} doc={doc} n={n} />;
          case "sportsAreas":
            return <SportsAreas key={id} doc={doc} n={n} />;
          case "aiSummary":
            return <AiSummary key={id} doc={doc} n={n} />;
          case "suggestions":
            return <Suggestions key={id} doc={doc} n={n} />;
          case "map":
            return <MapPage key={id} doc={doc} n={n} />;
          case "sweep":
            return <Sweep key={id} doc={doc} n={n} />;
          case "observations":
            return <Observations key={id} doc={doc} n={n} />;
          case "limitations":
            return <Limitations key={id} doc={doc} n={n} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

/** Escape the few characters that matter inside `<title>` and `<style>`. */
function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The whole document, ready for Chromium or for a browser preview.
 *
 * Stable output for stable input — this is what the golden files pin.
 */
export async function renderReportHtml(doc: ReportDocument): Promise<string> {
  const body = await renderStaticMarkup(<ReportBody doc={doc} />);
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeText(doc.meta.title)}</title>`,
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
