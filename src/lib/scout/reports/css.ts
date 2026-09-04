/**
 * The report stylesheet, as a string.
 *
 * A string rather than a CSS module because the output is one **self-contained
 * HTML document** handed to headless Chromium — there is no bundler in that
 * path, and a hashed class name from a module would arrive without the file
 * that defines it. This is the same shape v16 used (`REP_CSS`), for the same
 * reason.
 *
 * ## Why A5, and why the competitor tables are not tables
 *
 * The design ranks WhatsApp above Download PDF on both platforms, so this
 * document is read on a phone before it is ever read on paper. Two decisions
 * follow, and they are the two that matter most in this file:
 *
 * 1. **The page is A5 portrait, not A4.** A4 at 11 pt gives roughly 90
 *    characters a line; fitted to a 390 px phone that is about 8 px of type and
 *    the reader pinches. A5 at 13 pt gives about 54 characters a line — close
 *    to a well-set mobile web page — and A5 is a real paper size that prints
 *    two-up on A4 rather than a bespoke sheet nobody's printer knows.
 * 2. **Competitors render as stacked rows, not six-column tables.** No page
 *    size makes a six-column table legible on a phone. Each competitor is a
 *    two-line row: name and distance on the first, rating, review volume,
 *    operating window and price tier on the second.
 *
 * ## Page breaks
 *
 * `break-inside: avoid` on every row, card and quote; `break-after: avoid` on
 * every heading. A heading stranded at the foot of a page, or a competitor
 * whose second line is on the next sheet, is exactly the defect that makes a
 * generated document look generated.
 *
 * Page numbers and the legal footer are **not** in this file. Chromium
 * implements neither `@page` margin boxes nor CSS counters in them, so they
 * come from `headerTemplate`/`footerTemplate` in `pdf.ts`, which is the
 * supported mechanism and the only one that puts the client's footer on every
 * page including the last.
 */

import { REPORT_FONT_STACKS } from "./brand";

/** The page box. Shared with `pdf.ts` so both agree on one number. */
export const REPORT_PAGE = {
  widthMm: 148,
  heightMm: 210,
  marginTopMm: 14,
  marginBottomMm: 16,
  marginSideMm: 12,
} as const;

export const REPORT_FONT_LINK =
  "https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&display=swap";

export function reportCss(): string {
  return `
:root{
  --ink:#1c1c1e; --black:#0a0a0a; --gray-700:#3a3a3c; --gray-500:#6e6e73;
  --gray-300:#c7c7cc; --gray-200:#e2e2e6; --gray-100:#ededed; --white:#ffffff;
  --green:#159341; --green-100:#e2f4e9; --red:#c81124; --red-100:#fae4e7;
  --blue:#00aeef; --blue-100:#e3f4fc; --navy:#2e3192; --amber:#8a6d00; --amber-100:#fdf3d8;
  --font-display:${REPORT_FONT_STACKS.display};
  --font-body:${REPORT_FONT_STACKS.body};
}

@page{ size:${REPORT_PAGE.widthMm}mm ${REPORT_PAGE.heightMm}mm; margin:${REPORT_PAGE.marginTopMm}mm ${REPORT_PAGE.marginSideMm}mm ${REPORT_PAGE.marginBottomMm}mm; }

*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; background:var(--white); }
body{
  font-family:var(--font-body);
  font-size:13pt;
  line-height:1.55;
  color:var(--ink);
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}

/* ------------------------------------------------------------ structure */

.section{ break-before:page; }
.section:first-of-type{ break-before:auto; }
.section > *:first-child{ margin-top:0; }

h1,h2,h3,h4{ break-after:avoid; page-break-after:avoid; margin:0; }
h1{ font-family:var(--font-display); font-size:20pt; line-height:1.2; letter-spacing:-.01em; font-weight:700; }
h2{
  font-size:14pt; font-weight:700; letter-spacing:-.005em;
  margin:0 0 8pt; padding-bottom:5pt; border-bottom:1.6pt solid var(--black);
}
h3{ font-size:12pt; font-weight:600; margin:14pt 0 5pt; }
p{ margin:0 0 8pt; }
ul{ margin:0 0 8pt; padding-left:16pt; }
li{ margin-bottom:4pt; break-inside:avoid; }

.eyebrow{
  font-family:var(--font-display); font-size:8pt; font-weight:700;
  letter-spacing:.13em; text-transform:uppercase; color:var(--gray-500);
}
.sectionNo{ color:var(--gray-500); font-weight:400; }
.muted{ color:var(--gray-500); }
.small{ font-size:10.5pt; line-height:1.5; }
.tiny{ font-size:9pt; line-height:1.45; color:var(--gray-500); }
.num{ font-family:var(--font-display); font-weight:700; font-variant-numeric:tabular-nums; }

/* ---------------------------------------------------------------- cover */

.coverHead{ display:flex; align-items:center; gap:8pt; border-bottom:2pt solid var(--black); padding-bottom:10pt; }
.mark{ width:20pt; height:20pt; border-radius:5pt; background:linear-gradient(120deg,#159341 0%,#73caf0 45%,#2e3192 80%,#c81124 100%); flex:none; }
.wordmark{ font-family:var(--font-display); font-size:10.5pt; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
.coverMeta{ margin-top:14pt; }
.coverMeta dl{ margin:0; display:grid; grid-template-columns:auto 1fr; gap:3pt 10pt; font-size:10.5pt; }
.coverMeta dt{ color:var(--gray-500); }
.coverMeta dd{ margin:0; font-weight:500; }

.verdictStrip{ margin:14pt 0; padding:12pt 14pt; border-radius:10pt; background:var(--black); color:var(--white); break-inside:avoid; }
.verdictStrip .score{ font-family:var(--font-display); font-size:34pt; font-weight:700; line-height:1; }
.verdictStrip .of{ font-size:10.5pt; color:rgba(255,255,255,.62); }
.verdictStrip .badgeRow{ margin-top:8pt; }

.badge{ display:inline-block; padding:2.5pt 8pt; border-radius:99pt; font-size:9.5pt; font-weight:700; letter-spacing:.02em; }
.badge.green{ background:var(--green-100); color:#0f7333; }
.badge.blue{ background:var(--blue-100); color:#00699a; }
.badge.red{ background:var(--red-100); color:#a30d1d; }
.badge.amber{ background:var(--amber-100); color:var(--amber); border:1pt solid var(--amber); }

.stats{ display:grid; grid-template-columns:1fr 1fr; gap:7pt; margin:12pt 0; }
.stat{ border:1pt solid var(--gray-200); border-radius:8pt; padding:8pt 9pt; break-inside:avoid; }
.stat.dark{ background:var(--black); color:var(--white); border-color:var(--black); }
.stat .v{ font-family:var(--font-display); font-size:16pt; font-weight:700; line-height:1.1; }
.stat .l{ font-size:8pt; letter-spacing:.08em; text-transform:uppercase; color:var(--gray-500); margin-top:3pt; }
.stat.dark .l{ color:rgba(255,255,255,.6); }
.stat .n{ font-size:8.5pt; color:var(--gray-500); margin-top:3pt; line-height:1.35; }
.stat.dark .n{ color:rgba(255,255,255,.55); }

/* -------------------------------------------------------------- verdict */

.component{ break-inside:avoid; border-top:1pt solid var(--gray-200); padding:8pt 0; }
.component:first-of-type{ border-top:0; }
.componentHead{ display:flex; justify-content:space-between; align-items:baseline; gap:8pt; }
.componentHead .name{ font-weight:600; font-size:11.5pt; }
.componentHead .pts{ font-family:var(--font-display); font-weight:700; font-size:11pt; white-space:nowrap; }
.bar{ height:5pt; border-radius:3pt; background:var(--blue-100); margin:5pt 0 6pt; overflow:hidden; }
.bar > i{ display:block; height:100%; background:var(--blue); }
.bar.excluded{ background:transparent; border:1pt dashed var(--gray-300); }
.justification{ font-size:10.5pt; line-height:1.5; margin:0; }
.parts{ margin:5pt 0 0; padding-left:14pt; font-size:9.5pt; color:var(--gray-700); }

.callout{ break-inside:avoid; border-left:3pt solid var(--black); background:var(--gray-100); padding:8pt 10pt; margin:10pt 0; font-size:10.5pt; line-height:1.5; }
.callout.warn{ border-left-color:var(--red); background:var(--red-100); }
.callout.note{ border-left-color:var(--blue); background:var(--blue-100); }
.callout.amber{ border-left-color:var(--amber); background:var(--amber-100); }
.callout p:last-child{ margin-bottom:0; }
.callout .h{ font-weight:700; display:block; margin-bottom:3pt; }

/* --------------------------------------------------------------- tables */

table{ width:100%; border-collapse:collapse; font-size:10.5pt; }
thead{ display:table-header-group; }
tr{ break-inside:avoid; page-break-inside:avoid; }
th{
  text-align:left; font-size:8pt; font-weight:700; letter-spacing:.08em; text-transform:uppercase;
  color:var(--gray-500); border-bottom:1.4pt solid var(--black); padding:4pt 5pt;
}
td{ border-bottom:1pt solid var(--gray-200); padding:5pt 5pt; vertical-align:top; }
td.r,th.r{ text-align:right; }
.tableNote{ font-size:9pt; color:var(--gray-500); margin:5pt 0 0; }

/* Competitors: two-line rows, because six columns do not fit a phone. */
.venue{ break-inside:avoid; border-bottom:1pt solid var(--gray-200); padding:7pt 0; }
.venueTop{ display:flex; justify-content:space-between; gap:8pt; align-items:baseline; }
.venueName{ font-weight:600; font-size:11.5pt; }
.venueDist{ font-family:var(--font-display); font-weight:700; font-size:10pt; white-space:nowrap; }
.venueMeta{ font-size:9.5pt; color:var(--gray-700); margin-top:2pt; }
.venueMeta span + span::before{ content:" · "; color:var(--gray-300); }

.quote{ break-inside:avoid; margin:6pt 0; padding:7pt 10pt; border-left:2.5pt solid var(--gray-300); background:var(--gray-100); font-size:10.5pt; font-style:italic; }
.quote .src{ display:block; font-style:normal; font-size:8.5pt; color:var(--gray-500); margin-top:3pt; }

.theme{ break-inside:avoid-page; margin-bottom:10pt; }
.themeHead{ display:flex; justify-content:space-between; align-items:baseline; gap:8pt; }
.themeHead .n{ font-weight:700; font-size:11.5pt; }

/* ------------------------------------------------------------------ map */

.mapFrame{ break-inside:avoid; border:1pt solid var(--gray-200); border-radius:8pt; overflow:hidden; }
.mapFrame img{ display:block; width:100%; height:auto; }

/* --------------------------------------------------------------- notes */

.fieldNotes{ white-space:pre-wrap; background:var(--gray-100); border-left:3pt solid var(--black); padding:9pt 11pt; font-size:11pt; line-height:1.55; break-inside:auto; }

/* ------------------------------------------------------------ end page */

.endMatter{ margin-top:14pt; padding-top:8pt; border-top:1pt solid var(--gray-200); }
.disclaimer{ font-size:9pt; line-height:1.45; color:var(--gray-700); }

/* Screen preview only — on paper the page box already provides the frame. */
@media screen{
  body{ background:var(--gray-100); }
  .page{
    width:${REPORT_PAGE.widthMm}mm;
    margin:0 auto;
    padding:${REPORT_PAGE.marginTopMm}mm ${REPORT_PAGE.marginSideMm}mm ${REPORT_PAGE.marginBottomMm}mm;
    background:var(--white);
    box-shadow:0 4px 16px rgba(10,10,10,.10);
  }
}
`.trim();
}
