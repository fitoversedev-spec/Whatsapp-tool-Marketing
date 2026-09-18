import "server-only";

import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFFont,
  PDFPage,
} from "pdf-lib";
import type { ReportDocument, CompetitorCategory, ScanResultCategoryGroup } from "./types";
import { REPORT_SECTION_TITLES } from "./types";
import type { PdfResult } from "./pdf";

const SAFE_REPLACEMENTS: Record<string, string> = {
  "₹": "Rs.",
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
  "…": "...",
  "→": "->",
  "←": "<-",
  "—": "-",
  "–": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  " ": " ",
  "•": "-",
  "★": "*",
};

function sanitize(text: string): string {
  if (!text) return "";
  let out = text;
  for (const [from, to] of Object.entries(SAFE_REPLACEMENTS)) {
    out = out.split(from).join(to);
  }
  return out.replace(/[^\x00-\xFF]/g, "");
}

// A5 in points: 148mm x 210mm ≈ 419.53 x 595.28
const PAGE_W = 419.53;
const PAGE_H = 595.28;
const MARGIN = 28;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LINE_HEIGHT = 13;
const SMALL_LINE = 10;
const SECTION_GAP = 18;
const FOOTER_RESERVE = 28;

const COL = {
  ink: rgb(0.11, 0.11, 0.12),
  muted: rgb(0.43, 0.43, 0.45),
  heading: rgb(0.08, 0.36, 0.15),
  accent: rgb(0.08, 0.58, 0.25),
  border: rgb(0.78, 0.80, 0.83),
  rowAlt: rgb(0.96, 0.96, 0.97),
  white: rgb(1, 1, 1),
  green: rgb(0.08, 0.58, 0.25),
  blue: rgb(0, 0.68, 0.94),
  red: rgb(0.78, 0.07, 0.14),
};

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

interface Cursor {
  y: number;
}

function needPage(
  doc: PDFDocument,
  fonts: Fonts,
  cursor: Cursor,
  needed: number,
  footerText: string,
  pageNum: { n: number },
): PDFPage {
  if (cursor.y - needed < MARGIN + FOOTER_RESERVE) {
    drawFooter(doc.getPages()[doc.getPageCount() - 1], fonts, footerText, pageNum.n);
    pageNum.n++;
    const page = doc.addPage([PAGE_W, PAGE_H]);
    cursor.y = PAGE_H - MARGIN;
    return page;
  }
  return doc.getPages()[doc.getPageCount() - 1];
}

function drawFooter(page: PDFPage, fonts: Fonts, text: string, pageNum: number) {
  const footerY = 12;
  page.drawText(sanitize(text), {
    x: MARGIN,
    y: footerY,
    size: 5.5,
    font: fonts.regular,
    color: COL.muted,
    maxWidth: CONTENT_W - 40,
  });
  const numText = `${pageNum}`;
  const numW = fonts.regular.widthOfTextAtSize(numText, 5.5);
  page.drawText(numText, {
    x: PAGE_W - MARGIN - numW,
    y: footerY,
    size: 5.5,
    font: fonts.regular,
    color: COL.muted,
  });
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitize(text).split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function drawWrapped(
  page: PDFPage,
  text: string,
  x: number,
  cursor: Cursor,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
  maxWidth: number,
  lineH: number,
  doc: PDFDocument,
  fonts: Fonts,
  footerText: string,
  pageNum: { n: number },
): PDFPage {
  const lines = wrapText(text, font, size, maxWidth);
  let currentPage = page;
  for (const line of lines) {
    currentPage = needPage(doc, fonts, cursor, lineH, footerText, pageNum);
    currentPage.drawText(line, { x, y: cursor.y, size, font, color });
    cursor.y -= lineH;
  }
  return currentPage;
}

function drawSectionTitle(
  page: PDFPage,
  n: number,
  sectionId: string,
  fonts: Fonts,
  cursor: Cursor,
  doc: PDFDocument,
  footerText: string,
  pageNum: { n: number },
): PDFPage {
  const title = REPORT_SECTION_TITLES[sectionId as keyof typeof REPORT_SECTION_TITLES] ?? sectionId;
  const currentPage = needPage(doc, fonts, cursor, 24, footerText, pageNum);
  currentPage.drawText(sanitize(`${n}. ${title}`), {
    x: MARGIN,
    y: cursor.y,
    size: 12,
    font: fonts.bold,
    color: COL.heading,
  });
  cursor.y -= 18;
  return currentPage;
}

export async function renderReportPdfLib(
  report: ReportDocument,
  options: { headerText: string; footerText: string },
): Promise<PdfResult> {
  const started = Date.now();
  const pdfDoc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
  };

  const footerText = options.footerText;
  const pageNum = { n: 1 };
  const cursor: Cursor = { y: PAGE_H - MARGIN };

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  // ─── Cover page ──────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: PAGE_H - 4, width: PAGE_W, height: 4, color: COL.green });

  cursor.y = PAGE_H - MARGIN - 20;
  page.drawText("SITE SCOUT", {
    x: MARGIN,
    y: cursor.y,
    size: 9,
    font: fonts.bold,
    color: COL.accent,
  });
  cursor.y -= 20;

  const titleLines = wrapText(report.meta.title || report.meta.areaLabel, fonts.bold, 18, CONTENT_W);
  for (const line of titleLines) {
    page.drawText(line, { x: MARGIN, y: cursor.y, size: 18, font: fonts.bold, color: COL.ink });
    cursor.y -= 24;
  }
  cursor.y -= 4;

  const coverInfo = [
    `Radius: ${report.meta.radiusLabel}`,
    `Area: ${report.meta.areaKm2.toFixed(1)} sq km`,
    report.meta.address ? `Address: ${report.meta.address}` : null,
    report.meta.customerName ? `Customer: ${report.meta.customerName}` : null,
    `Prepared by: ${report.meta.preparedBy}`,
    `Generated: ${report.meta.generatedAtLabel}`,
    `Version: ${report.meta.version}`,
  ].filter(Boolean) as string[];

  for (const info of coverInfo) {
    page.drawText(sanitize(info), { x: MARGIN, y: cursor.y, size: 8, font: fonts.regular, color: COL.muted });
    cursor.y -= SMALL_LINE;
  }
  cursor.y -= 8;

  // Cover verdict
  if (report.cover.verdictLabel) {
    const tone = report.cover.verdictTone === "green" ? COL.green
      : report.cover.verdictTone === "red" ? COL.red
      : COL.blue;
    page.drawText(sanitize(report.cover.verdictLabel.toUpperCase()), {
      x: MARGIN, y: cursor.y, size: 14, font: fonts.bold, color: tone,
    });
    cursor.y -= 18;
  }
  if (report.cover.scoreLine) {
    page.drawText(sanitize(report.cover.scoreLine), {
      x: MARGIN, y: cursor.y, size: 8, font: fonts.regular, color: COL.muted,
    });
    cursor.y -= SMALL_LINE;
  }

  page = drawWrapped(page, report.cover.summarySentence, MARGIN, cursor, fonts.italic, 8, COL.ink, CONTENT_W, SMALL_LINE, pdfDoc, fonts, footerText, pageNum);
  cursor.y -= 6;

  // Cover stats
  if (report.cover.stats) {
    for (const stat of report.cover.stats) {
      page = needPage(pdfDoc, fonts, cursor, 12, footerText, pageNum);
      page.drawText(sanitize(`${stat.label}: ${stat.value}`), {
        x: MARGIN, y: cursor.y, size: 7.5, font: fonts.regular, color: COL.ink,
      });
      cursor.y -= SMALL_LINE;
    }
  }

  drawFooter(page, fonts, footerText, pageNum.n);
  pageNum.n++;
  cursor.y = PAGE_H - MARGIN;

  // ─── Numbered sections ──────────────────────────────────────
  let sectionNum = 0;

  for (const sectionId of report.sections) {
    if (sectionId === "cover") continue;
    sectionNum++;

    // Force new page for major sections
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    cursor.y = PAGE_H - MARGIN;

    page = drawSectionTitle(page, sectionNum, sectionId, fonts, cursor, pdfDoc, footerText, pageNum);

    switch (sectionId) {
      case "verdict":
        page = renderVerdict(pdfDoc, page, report, fonts, cursor, footerText, pageNum);
        break;
      case "catchment":
        page = renderCatchment(pdfDoc, page, report, fonts, cursor, footerText, pageNum);
        break;
      case "competition":
        page = renderCompetition(pdfDoc, page, report, fonts, cursor, footerText, pageNum);
        break;
      case "demand":
        page = renderDemand(pdfDoc, page, report, fonts, cursor, footerText, pageNum);
        break;
      case "sportsAreas":
        page = renderSportsAreas(pdfDoc, page, report, fonts, cursor, footerText, pageNum);
        break;
      case "aiSummary":
        page = renderAiSummary(pdfDoc, page, report, fonts, cursor, footerText, pageNum);
        break;
      case "suggestions":
        page = renderSuggestions(pdfDoc, page, report, fonts, cursor, footerText, pageNum);
        break;
      case "map":
        page = await renderMap(pdfDoc, page, report, fonts, cursor, footerText, pageNum);
        break;
      case "observations":
        page = renderObservations(pdfDoc, page, report, fonts, cursor, footerText, pageNum);
        break;
      case "limitations":
        page = renderLimitations(pdfDoc, page, report, fonts, cursor, footerText, pageNum);
        break;
      case "scanResults":
        page = renderScanResults(pdfDoc, page, report, fonts, cursor, footerText, pageNum);
        break;
      case "sweep":
        page = renderSweep(pdfDoc, page, report, fonts, cursor, footerText, pageNum);
        break;
    }

    drawFooter(page, fonts, footerText, pageNum.n);
    pageNum.n++;
  }

  const bytes = Buffer.from(await pdfDoc.save());
  return {
    bytes,
    engine: "pdf-lib",
    pageCount: pdfDoc.getPageCount(),
    durationMs: Date.now() - started,
  };
}

// ─── Section renderers ──────────────────────────────────────────

function renderVerdict(
  doc: PDFDocument, page: PDFPage, report: ReportDocument,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
): PDFPage {
  const v = report.verdict;
  if (!v) return page;

  page.drawText(sanitize(`${v.total} / ${v.outOf}`), {
    x: MARGIN, y: cursor.y, size: 16, font: fonts.bold, color: COL.ink,
  });
  cursor.y -= 20;

  const tone = v.verdictTone === "green" ? COL.green : v.verdictTone === "red" ? COL.red : COL.blue;
  page.drawText(sanitize(v.verdictLabel.toUpperCase()), {
    x: MARGIN, y: cursor.y, size: 11, font: fonts.bold, color: tone,
  });
  cursor.y -= 16;

  page = drawWrapped(page, v.statement, MARGIN, cursor, fonts.regular, 7.5, COL.ink, CONTENT_W, SMALL_LINE, doc, fonts, footerText, pageNum);
  cursor.y -= 8;

  // Components
  for (const comp of v.components) {
    page = needPage(doc, fonts, cursor, 28, footerText, pageNum);
    page.drawText(sanitize(`${comp.label}: ${comp.points}`), {
      x: MARGIN, y: cursor.y, size: 7.5, font: fonts.bold, color: COL.ink,
    });
    cursor.y -= SMALL_LINE;

    if (comp.fraction !== null) {
      const barW = 120;
      const barH = 5;
      page.drawRectangle({ x: MARGIN, y: cursor.y - 1, width: barW, height: barH, color: COL.rowAlt });
      page.drawRectangle({ x: MARGIN, y: cursor.y - 1, width: barW * comp.fraction, height: barH, color: tone });
      cursor.y -= 10;
    }

    page = drawWrapped(page, comp.justification, MARGIN + 8, cursor, fonts.italic, 6.5, COL.muted, CONTENT_W - 8, 9, doc, fonts, footerText, pageNum);
    cursor.y -= 6;
  }

  return page;
}

function renderCatchment(
  doc: PDFDocument, page: PDFPage, report: ReportDocument,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
): PDFPage {
  const c = report.catchment;
  page = drawWrapped(page, `${c.radiusLine}. ${c.areaLine}`, MARGIN, cursor, fonts.regular, 8, COL.ink, CONTENT_W, LINE_HEIGHT, doc, fonts, footerText, pageNum);
  cursor.y -= 6;

  for (const anchor of c.anchors) {
    page = needPage(doc, fonts, cursor, 12, footerText, pageNum);
    const line = `${anchor.label}: ${anchor.count}${anchor.nearestName ? ` (nearest: ${anchor.nearestName}, ${anchor.nearestDistance})` : ""}`;
    page.drawText(sanitize(line), { x: MARGIN, y: cursor.y, size: 7, font: fonts.regular, color: COL.ink });
    cursor.y -= SMALL_LINE;
  }

  if (c.saturation) {
    cursor.y -= 6;
    page = needPage(doc, fonts, cursor, 24, footerText, pageNum);
    page.drawText(sanitize(`Saturation: ${c.saturation.figure}`), {
      x: MARGIN, y: cursor.y, size: 8, font: fonts.bold, color: COL.ink,
    });
    cursor.y -= SMALL_LINE;
    page = drawWrapped(page, c.saturation.justification, MARGIN, cursor, fonts.regular, 7, COL.muted, CONTENT_W, 9, doc, fonts, footerText, pageNum);
    cursor.y -= 6;
  }

  if (c.observations.length > 0) {
    cursor.y -= 4;
    for (const obs of c.observations) {
      page = drawWrapped(page, `- ${obs}`, MARGIN, cursor, fonts.regular, 7, COL.ink, CONTENT_W, 9, doc, fonts, footerText, pageNum);
      cursor.y -= 3;
    }
  }

  return page;
}

function renderCompetitorTable(
  doc: PDFDocument, page: PDFPage, category: CompetitorCategory,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
): PDFPage {
  page = needPage(doc, fonts, cursor, 28, footerText, pageNum);

  page.drawCircle({ x: MARGIN + 3.5, y: cursor.y + 3, size: 3.5, color: rgb(21 / 255, 147 / 255, 65 / 255) });
  const titleText = category.titleSuffix
    ? `${category.label} (${category.titleSuffix})`
    : category.label;
  page.drawText(sanitize(titleText), {
    x: MARGIN + 11, y: cursor.y, size: 9, font: fonts.bold, color: COL.ink,
  });
  cursor.y -= 12;
  page.drawText(sanitize(category.countLine), {
    x: MARGIN, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.muted,
  });
  cursor.y -= 10;

  // Table header
  const cols = { name: MARGIN, rating: MARGIN + 140, dist: MARGIN + 200, floor: MARGIN + 260 };
  const hasFlooring = category.rows.some((r) => r.flooring);

  page = needPage(doc, fonts, cursor, 12, footerText, pageNum);
  page.drawRectangle({ x: MARGIN, y: cursor.y - 2, width: CONTENT_W, height: 11, color: COL.rowAlt });
  page.drawText("Name", { x: cols.name + 2, y: cursor.y, size: 6, font: fonts.bold, color: COL.muted });
  page.drawText("Rating", { x: cols.rating, y: cursor.y, size: 6, font: fonts.bold, color: COL.muted });
  page.drawText("Distance", { x: cols.dist, y: cursor.y, size: 6, font: fonts.bold, color: COL.muted });
  if (hasFlooring) {
    page.drawText("Flooring", { x: cols.floor, y: cursor.y, size: 6, font: fonts.bold, color: COL.muted });
  }
  cursor.y -= 12;

  for (let i = 0; i < category.rows.length; i++) {
    const row = category.rows[i];
    page = needPage(doc, fonts, cursor, 11, footerText, pageNum);

    if (i % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: cursor.y - 2, width: CONTENT_W, height: 10, color: COL.rowAlt });
    }

    const nameText = sanitize(row.name).substring(0, 30);
    page.drawText(nameText, { x: cols.name + 2, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.ink });
    page.drawText(sanitize(`${row.rating}* (${row.reviews})`), { x: cols.rating, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.ink });
    page.drawText(sanitize(row.distance), { x: cols.dist, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.ink });
    if (hasFlooring && row.flooring) {
      page.drawText(sanitize(row.flooring).substring(0, 20), { x: cols.floor, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.ink });
    }
    cursor.y -= 10;
  }

  if (category.overflow > 0) {
    page.drawText(sanitize(`+ ${category.overflow} more inside the radius`), {
      x: MARGIN, y: cursor.y, size: 6, font: fonts.italic, color: COL.muted,
    });
    cursor.y -= 10;
  }
  cursor.y -= 6;

  return page;
}

function renderCompetition(
  doc: PDFDocument, page: PDFPage, report: ReportDocument,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
): PDFPage {
  const c = report.competition;
  page = drawWrapped(page, c.headline, MARGIN, cursor, fonts.bold, 8, COL.ink, CONTENT_W, LINE_HEIGHT, doc, fonts, footerText, pageNum);
  cursor.y -= 6;
  page = drawWrapped(page, c.caveat, MARGIN, cursor, fonts.italic, 6.5, COL.muted, CONTENT_W, 9, doc, fonts, footerText, pageNum);
  cursor.y -= 8;

  for (const category of c.categories) {
    page = renderCompetitorTable(doc, page, category, fonts, cursor, footerText, pageNum);
  }

  // Complaint themes
  if (c.themes.length > 0) {
    page = needPage(doc, fonts, cursor, 20, footerText, pageNum);
    page.drawText("What customers complain about", {
      x: MARGIN, y: cursor.y, size: 9, font: fonts.bold, color: COL.ink,
    });
    cursor.y -= 14;

    page = drawWrapped(page, c.themeState, MARGIN, cursor, fonts.regular, 6.5, COL.muted, CONTENT_W, 9, doc, fonts, footerText, pageNum);
    cursor.y -= 6;

    for (const theme of c.themes) {
      page = needPage(doc, fonts, cursor, 24, footerText, pageNum);
      page.drawText(sanitize(`${theme.label} (${theme.venueCount} venue${theme.venueCount === 1 ? "" : "s"})`), {
        x: MARGIN, y: cursor.y, size: 7.5, font: fonts.bold, color: COL.ink,
      });
      cursor.y -= SMALL_LINE;
      page = drawWrapped(page, theme.summary, MARGIN + 8, cursor, fonts.regular, 6.5, COL.muted, CONTENT_W - 8, 9, doc, fonts, footerText, pageNum);
      cursor.y -= 4;

      for (const quote of theme.quotes) {
        page = needPage(doc, fonts, cursor, 16, footerText, pageNum);
        page = drawWrapped(page, `"${quote.quote}" - ${quote.venue}`, MARGIN + 12, cursor, fonts.italic, 6, COL.muted, CONTENT_W - 16, 8, doc, fonts, footerText, pageNum);
        cursor.y -= 4;
      }
      cursor.y -= 4;
    }
  }

  return page;
}

function renderDemand(
  doc: PDFDocument, page: PDFPage, report: ReportDocument,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
): PDFPage {
  const d = report.demand;
  page = drawWrapped(page, d.headline, MARGIN, cursor, fonts.bold, 8, COL.ink, CONTENT_W, LINE_HEIGHT, doc, fonts, footerText, pageNum);
  cursor.y -= 6;

  for (const row of d.rows) {
    page = needPage(doc, fonts, cursor, 12, footerText, pageNum);
    const line = `${row.label}: ${row.count}${row.nearestName ? ` (nearest: ${row.nearestName}, ${row.nearestDistance})` : ""}`;
    page.drawText(sanitize(line), { x: MARGIN, y: cursor.y, size: 7, font: fonts.regular, color: COL.ink });
    cursor.y -= SMALL_LINE;
  }

  if (d.countTable) {
    cursor.y -= 8;
    page = needPage(doc, fonts, cursor, 16, footerText, pageNum);
    page.drawText("Count table", { x: MARGIN, y: cursor.y, size: 8, font: fonts.bold, color: COL.ink });
    cursor.y -= 12;

    for (const row of d.countTable) {
      page = needPage(doc, fonts, cursor, 10, footerText, pageNum);
      page.drawText(sanitize(`${row.label}: ${row.count} (${row.reviews} reviews, nearest ${row.nearest})`), {
        x: MARGIN, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.ink,
      });
      cursor.y -= 9;
    }
  }

  return page;
}

function renderSportsAreas(
  doc: PDFDocument, page: PDFPage, report: ReportDocument,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
): PDFPage {
  const s = report.sportsAreas;
  if (!s) return page;

  page = drawWrapped(page, s.headline, MARGIN, cursor, fonts.bold, 8, COL.ink, CONTENT_W, LINE_HEIGHT, doc, fonts, footerText, pageNum);
  cursor.y -= 8;

  for (const row of s.rows) {
    page = needPage(doc, fonts, cursor, 10, footerText, pageNum);
    page.drawText(sanitize(`${row.name} (${row.category}) - ${row.distance} - ${row.rating}* (${row.reviews} reviews)`), {
      x: MARGIN, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.ink,
    });
    cursor.y -= 9;
  }

  return page;
}

function renderAiSummary(
  doc: PDFDocument, page: PDFPage, report: ReportDocument,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
): PDFPage {
  const ai = report.aiSummary;
  if (!ai) return page;
  page = drawWrapped(page, ai.summary, MARGIN, cursor, fonts.regular, 7.5, COL.ink, CONTENT_W, SMALL_LINE, doc, fonts, footerText, pageNum);
  return page;
}

function renderSuggestions(
  doc: PDFDocument, page: PDFPage, report: ReportDocument,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
): PDFPage {
  const s = report.suggestions;
  if (!s) return page;
  page = drawWrapped(page, s.text, MARGIN, cursor, fonts.regular, 7.5, COL.ink, CONTENT_W, SMALL_LINE, doc, fonts, footerText, pageNum);
  return page;
}

async function renderMap(
  doc: PDFDocument, page: PDFPage, report: ReportDocument,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
): Promise<PDFPage> {
  const m = report.map;
  if (!m) return page;

  // Try to embed the map image (it's a data URI or URL)
  try {
    if (m.url.startsWith("data:")) {
      const base64Match = m.url.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
      if (base64Match) {
        const imageBytes = Buffer.from(base64Match[2], "base64");
        const isPngImage = base64Match[1] === "png";
        const image = isPngImage
          ? await doc.embedPng(imageBytes)
          : await doc.embedJpg(imageBytes);

        const maxW = CONTENT_W;
        const maxH = 200;
        const scale = Math.min(maxW / image.width, maxH / image.height, 1);
        const drawW = image.width * scale;
        const drawH = image.height * scale;

        page = needPage(doc, fonts, cursor, drawH + 10, footerText, pageNum);
        page.drawImage(image, {
          x: MARGIN,
          y: cursor.y - drawH,
          width: drawW,
          height: drawH,
        });
        cursor.y -= drawH + 8;
      }
    }
  } catch {
    page.drawText("[Map image could not be embedded]", {
      x: MARGIN, y: cursor.y, size: 7, font: fonts.italic, color: COL.muted,
    });
    cursor.y -= 12;
  }

  // Simple color legend under map (dot + category + count)
  const sr = report.scanResults;
  if (sr) {
    cursor.y -= 6;
    let legendX = MARGIN;
    const groups = [
      ...sr.competitionGroups.filter((g) => g.places.length > 0).map((g) => ({ ...g, dotColor: rgb(21 / 255, 147 / 255, 65 / 255) })),
      ...sr.demandGroups.filter((g) => g.places.length > 0).map((g) => ({ ...g, dotColor: rgb(0, 174 / 255, 239 / 255) })),
    ];
    page = needPage(doc, fonts, cursor, 12, footerText, pageNum);
    for (const g of groups) {
      page.drawCircle({ x: legendX + 3, y: cursor.y + 2, size: 3, color: g.dotColor });
      const label = sanitize(`${g.label} (${g.count})`);
      page.drawText(label, { x: legendX + 9, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.muted });
      legendX += 9 + fonts.regular.widthOfTextAtSize(label, 6.5) + 16;
    }
    cursor.y -= 10;
  }

  return page;
}

function renderObservations(
  doc: PDFDocument, page: PDFPage, report: ReportDocument,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
): PDFPage {
  const o = report.observations;
  if (!o) return page;

  page = drawWrapped(page, o.answeredLine, MARGIN, cursor, fonts.regular, 7, COL.muted, CONTENT_W, 9, doc, fonts, footerText, pageNum);
  cursor.y -= 6;

  for (const group of o.groups) {
    page = needPage(doc, fonts, cursor, 16, footerText, pageNum);
    page.drawText(sanitize(group.label), {
      x: MARGIN, y: cursor.y, size: 8, font: fonts.bold, color: COL.ink,
    });
    cursor.y -= 12;

    for (const field of group.fields) {
      page = needPage(doc, fonts, cursor, 10, footerText, pageNum);
      page.drawText(sanitize(`${field.label}: ${field.rating} (${field.anchor})`), {
        x: MARGIN + 4, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.ink,
      });
      cursor.y -= 9;
    }
    cursor.y -= 4;
  }

  if (o.fieldNotes) {
    cursor.y -= 4;
    page = needPage(doc, fonts, cursor, 16, footerText, pageNum);
    page.drawText("Field notes", { x: MARGIN, y: cursor.y, size: 7.5, font: fonts.bold, color: COL.ink });
    cursor.y -= 10;
    page = drawWrapped(page, o.fieldNotes, MARGIN, cursor, fonts.regular, 7, COL.ink, CONTENT_W, 9, doc, fonts, footerText, pageNum);
  }

  return page;
}

function renderLimitations(
  doc: PDFDocument, page: PDFPage, report: ReportDocument,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
): PDFPage {
  const l = report.limitations;
  for (const para of l.paragraphs) {
    page = drawWrapped(page, para, MARGIN, cursor, fonts.regular, 7, COL.ink, CONTENT_W, 9, doc, fonts, footerText, pageNum);
    cursor.y -= 6;
  }
  for (const bullet of l.bullets) {
    page = drawWrapped(page, `- ${bullet}`, MARGIN, cursor, fonts.regular, 7, COL.ink, CONTENT_W, 9, doc, fonts, footerText, pageNum);
    cursor.y -= 3;
  }
  return page;
}

function renderScanResultGroup(
  doc: PDFDocument, page: PDFPage, group: ScanResultCategoryGroup,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
  showFlooring: boolean, dotColor: ReturnType<typeof rgb>,
): PDFPage {
  page = needPage(doc, fonts, cursor, 24, footerText, pageNum);

  page.drawCircle({ x: MARGIN + 3, y: cursor.y + 2.5, size: 3, color: dotColor });
  const titleText = group.distanceContext
    ? `${group.label} (${group.distanceContext})`
    : group.label;
  page.drawText(sanitize(titleText), {
    x: MARGIN + 10, y: cursor.y, size: 8, font: fonts.bold, color: COL.ink,
  });
  const countText = sanitize(`${group.count} found`);
  const countW = fonts.regular.widthOfTextAtSize(countText, 6.5);
  page.drawText(countText, {
    x: PAGE_W - MARGIN - countW, y: cursor.y + 1, size: 6.5, font: fonts.regular, color: COL.muted,
  });
  cursor.y -= 12;

  for (const place of group.places) {
    page = needPage(doc, fonts, cursor, 9, footerText, pageNum);
    const nameStr = sanitize(place.name).substring(0, 40);
    page.drawText(nameStr, { x: MARGIN + 4, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.ink });
    if (showFlooring && place.flooring) {
      page.drawText(sanitize(place.flooring).substring(0, 20), {
        x: MARGIN + 200, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.muted,
      });
    }
    const distText = sanitize(place.distance);
    const distW = fonts.regular.widthOfTextAtSize(distText, 6.5);
    page.drawText(distText, {
      x: PAGE_W - MARGIN - distW, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.muted,
    });
    cursor.y -= 9;
  }

  cursor.y -= 6;
  return page;
}

function renderScanResults(
  doc: PDFDocument, page: PDFPage, report: ReportDocument,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
): PDFPage {
  const s = report.scanResults;
  if (!s) return page;

  const hasFlooring = s.competitionGroups.some((g) => g.places.some((p) => p.flooring));

  if (s.competitionGroups.length > 0) {
    page = needPage(doc, fonts, cursor, 16, footerText, pageNum);
    page.drawText("Competition", { x: MARGIN, y: cursor.y, size: 9, font: fonts.bold, color: COL.ink });
    cursor.y -= 14;
    for (const group of s.competitionGroups) {
      page = renderScanResultGroup(doc, page, group, fonts, cursor, footerText, pageNum, hasFlooring, rgb(21 / 255, 147 / 255, 65 / 255));
    }
  }

  if (s.demandGroups.length > 0) {
    page = needPage(doc, fonts, cursor, 16, footerText, pageNum);
    page.drawText("Nearby places", { x: MARGIN, y: cursor.y, size: 9, font: fonts.bold, color: COL.ink });
    cursor.y -= 14;
    for (const group of s.demandGroups) {
      page = renderScanResultGroup(doc, page, group, fonts, cursor, footerText, pageNum, false, rgb(0, 174 / 255, 239 / 255));
    }
  }

  return page;
}

function renderSweep(
  doc: PDFDocument, page: PDFPage, report: ReportDocument,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
): PDFPage {
  const s = report.sweep;
  if (!s) return page;
  page = drawWrapped(page, s.summary, MARGIN, cursor, fonts.regular, 7.5, COL.ink, CONTENT_W, SMALL_LINE, doc, fonts, footerText, pageNum);
  cursor.y -= 8;

  for (const row of s.rows) {
    page = needPage(doc, fonts, cursor, 12, footerText, pageNum);
    page.drawText(sanitize(`${row.id} [${row.status}] ${row.coordinates}`), {
      x: MARGIN, y: cursor.y, size: 6.5, font: fonts.bold, color: COL.ink,
    });
    cursor.y -= 9;
    if (row.note) {
      page = drawWrapped(page, row.note, MARGIN + 8, cursor, fonts.regular, 6, COL.muted, CONTENT_W - 8, 8, doc, fonts, footerText, pageNum);
      cursor.y -= 4;
    }
  }

  if (s.caveat) {
    cursor.y -= 4;
    page = drawWrapped(page, s.caveat, MARGIN, cursor, fonts.italic, 6.5, COL.muted, CONTENT_W, 9, doc, fonts, footerText, pageNum);
  }

  return page;
}
