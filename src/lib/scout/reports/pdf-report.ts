import "server-only";

import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFFont,
  PDFPage,
} from "pdf-lib";
import type { ReportDocument, ScanResultCategoryGroup } from "./types";
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

// A5 in points: 148mm x 210mm
const PAGE_W = 419.53;
const PAGE_H = 595.28;
const MARGIN = 28;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_RESERVE = 28;

const COL = {
  ink: rgb(0.11, 0.11, 0.12),
  muted: rgb(0.43, 0.43, 0.45),
  heading: rgb(0.08, 0.36, 0.15),
  accent: rgb(0.08, 0.58, 0.25),
  border: rgb(0.78, 0.80, 0.83),
  white: rgb(1, 1, 1),
  green: rgb(21 / 255, 147 / 255, 65 / 255),
  blue: rgb(0, 174 / 255, 239 / 255),
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

/* ------------------------------------------------------------------ main */

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

  // ─── Header bar ──────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: PAGE_H - 4, width: PAGE_W, height: 4, color: COL.accent });

  cursor.y = PAGE_H - MARGIN - 6;

  page.drawText("SITE SCOUT REPORT", {
    x: MARGIN,
    y: cursor.y,
    size: 9,
    font: fonts.bold,
    color: COL.ink,
  });

  const dateText = sanitize(report.meta.generatedAtLabel);
  const dateW = fonts.regular.widthOfTextAtSize(dateText, 7);
  page.drawText(dateText, {
    x: PAGE_W - MARGIN - dateW,
    y: cursor.y + 1,
    size: 7,
    font: fonts.regular,
    color: COL.muted,
  });

  cursor.y -= 10;
  page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: PAGE_W - MARGIN, y: cursor.y },
    thickness: 1.5,
    color: COL.ink,
  });
  cursor.y -= 18;

  // ─── Area title ──────────────────────────────────────────────
  const areaLabel = sanitize(
    `${report.meta.title || report.meta.areaLabel} - ${report.meta.radiusLabel} radius`,
  );
  const titleLines = wrapText(areaLabel, fonts.bold, 14, CONTENT_W);
  for (const line of titleLines) {
    page.drawText(line, { x: MARGIN, y: cursor.y, size: 14, font: fonts.bold, color: COL.ink });
    cursor.y -= 20;
  }
  cursor.y -= 4;

  // ─── Catchment map ───────────────────────────────────────────
  page = drawSectionLabel(page, "CATCHMENT MAP", fonts, cursor, pdfDoc, footerText, pageNum);

  page = await embedMap(pdfDoc, page, report, fonts, cursor, footerText, pageNum);

  // Colored dot legend
  const sr = report.scanResults;
  if (sr) {
    cursor.y -= 4;
    let legendX = MARGIN;
    const groups = [
      ...sr.competitionGroups.filter((g) => g.places.length > 0).map((g) => ({ ...g, dotColor: COL.green })),
      ...sr.demandGroups.filter((g) => g.places.length > 0).map((g) => ({ ...g, dotColor: COL.blue })),
    ];
    page = needPage(pdfDoc, fonts, cursor, 12, footerText, pageNum);
    for (const g of groups) {
      page.drawCircle({ x: legendX + 3, y: cursor.y + 2, size: 3, color: g.dotColor });
      const label = sanitize(`${g.label} (${g.count})`);
      page.drawText(label, { x: legendX + 9, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.muted });
      legendX += 9 + fonts.regular.widthOfTextAtSize(label, 6.5) + 16;
      if (legendX > CONTENT_W) {
        legendX = MARGIN;
        cursor.y -= 10;
        page = needPage(pdfDoc, fonts, cursor, 12, footerText, pageNum);
      }
    }
    cursor.y -= 14;
  }

  // ─── Competition ─────────────────────────────────────────────
  if (sr && sr.competitionGroups.length > 0) {
    page = drawSectionLabel(page, "COMPETITION", fonts, cursor, pdfDoc, footerText, pageNum);

    const hasFlooring = sr.competitionGroups.some((g) => g.places.some((p) => p.flooring));
    for (const group of sr.competitionGroups) {
      page = renderCategoryGroup(pdfDoc, page, group, fonts, cursor, footerText, pageNum, hasFlooring, COL.green);
    }
  }

  // ─── Nearby places ───────────────────────────────────────────
  if (sr && sr.demandGroups.length > 0) {
    page = drawSectionLabel(page, "NEARBY PLACES", fonts, cursor, pdfDoc, footerText, pageNum);

    for (const group of sr.demandGroups) {
      page = renderCategoryGroup(pdfDoc, page, group, fonts, cursor, footerText, pageNum, false, COL.blue, true);
    }
  }

  // ─── Our suggestions ────────────────────────────────────────
  if (report.suggestions?.text) {
    page = drawSectionLabel(page, "OUR SUGGESTIONS", fonts, cursor, pdfDoc, footerText, pageNum);

    page = needPage(pdfDoc, fonts, cursor, 30, footerText, pageNum);
    const sugLines = wrapText(report.suggestions.text, fonts.regular, 7.5, CONTENT_W - 16);
    const blockH = sugLines.length * 10 + 12;
    page = needPage(pdfDoc, fonts, cursor, blockH, footerText, pageNum);

    page.drawRectangle({
      x: MARGIN,
      y: cursor.y - blockH + 10,
      width: 3,
      height: blockH,
      color: COL.green,
    });
    page.drawRectangle({
      x: MARGIN + 3,
      y: cursor.y - blockH + 10,
      width: CONTENT_W - 3,
      height: blockH,
      color: rgb(0.96, 0.96, 0.97),
    });

    const textX = MARGIN + 12;
    for (const line of sugLines) {
      page.drawText(line, { x: textX, y: cursor.y, size: 7.5, font: fonts.regular, color: COL.ink });
      cursor.y -= 10;
    }
    cursor.y -= 8;
  }

  // ─── Footer line ─────────────────────────────────────────────
  cursor.y -= 8;
  page = needPage(pdfDoc, fonts, cursor, 20, footerText, pageNum);
  page.drawLine({
    start: { x: MARGIN, y: cursor.y + 6 },
    end: { x: PAGE_W - MARGIN, y: cursor.y + 6 },
    thickness: 0.5,
    color: COL.border,
  });
  const prepLine = sanitize(
    `Prepared by ${report.meta.preparedBy} - Fitoverse - Data from public listings.`,
  );
  page.drawText(prepLine, {
    x: MARGIN,
    y: cursor.y - 4,
    size: 6.5,
    font: fonts.regular,
    color: COL.muted,
  });

  // Draw footer on last page
  drawFooter(page, fonts, footerText, pageNum.n);

  const bytes = Buffer.from(await pdfDoc.save());
  return {
    bytes,
    engine: "pdf-lib",
    pageCount: pdfDoc.getPageCount(),
    durationMs: Date.now() - started,
  };
}

/* ---------------------------------------------------------------- helpers */

function drawSectionLabel(
  page: PDFPage,
  label: string,
  fonts: Fonts,
  cursor: Cursor,
  doc: PDFDocument,
  footerText: string,
  pageNum: { n: number },
): PDFPage {
  const currentPage = needPage(doc, fonts, cursor, 20, footerText, pageNum);
  currentPage.drawText(label, {
    x: MARGIN,
    y: cursor.y,
    size: 7.5,
    font: fonts.bold,
    color: COL.muted,
  });
  cursor.y -= 14;
  return currentPage;
}

async function embedMap(
  doc: PDFDocument, page: PDFPage, report: ReportDocument,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
): Promise<PDFPage> {
  const m = report.map;
  if (!m) return page;

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

  return page;
}

function renderCategoryGroup(
  doc: PDFDocument, page: PDFPage, group: ScanResultCategoryGroup,
  fonts: Fonts, cursor: Cursor, footerText: string, pageNum: { n: number },
  showFlooring: boolean, dotColor: ReturnType<typeof rgb>,
  showNotes = false,
): PDFPage {
  page = needPage(doc, fonts, cursor, 24, footerText, pageNum);

  // Category header: dot + label + subtitle + count
  page.drawCircle({ x: MARGIN + 3, y: cursor.y + 2.5, size: 3, color: dotColor });
  page.drawText(sanitize(group.label), {
    x: MARGIN + 10, y: cursor.y, size: 8, font: fonts.bold, color: COL.ink,
  });

  if (group.distanceContext) {
    const labelW = fonts.bold.widthOfTextAtSize(sanitize(group.label), 8);
    const sub = sanitize(`(${group.distanceContext})`);
    page.drawText(sub, {
      x: MARGIN + 10 + labelW + 4, y: cursor.y + 0.5, size: 6, font: fonts.regular, color: COL.muted,
    });
  }

  const countText = sanitize(`${group.count} found`);
  const countW = fonts.regular.widthOfTextAtSize(countText, 6.5);
  page.drawText(countText, {
    x: PAGE_W - MARGIN - countW, y: cursor.y + 1, size: 6.5, font: fonts.regular, color: COL.muted,
  });
  cursor.y -= 4;

  // Separator line under header
  page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: PAGE_W - MARGIN, y: cursor.y },
    thickness: 0.5,
    color: COL.border,
  });
  cursor.y -= 9;

  // Place rows
  for (const place of group.places) {
    page = needPage(doc, fonts, cursor, 9, footerText, pageNum);
    let nameStr = sanitize(place.name).substring(0, 45);
    if (showFlooring && place.flooring) {
      nameStr += ` - ${sanitize(place.flooring).substring(0, 18)}`;
    }
    page.drawText(nameStr, { x: MARGIN + 4, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.ink });

    const distText = sanitize(place.distance);
    const distW = fonts.regular.widthOfTextAtSize(distText, 6.5);
    page.drawText(distText, {
      x: PAGE_W - MARGIN - distW, y: cursor.y, size: 6.5, font: fonts.regular, color: COL.muted,
    });

    cursor.y -= 9;

    if (showNotes && place.note) {
      page = needPage(doc, fonts, cursor, 8, footerText, pageNum);
      page.drawText(sanitize(place.note).substring(0, 80), {
        x: MARGIN + 8, y: cursor.y, size: 5.5, font: fonts.regular, color: COL.muted,
      });
      cursor.y -= 8;
    }

    // Light separator between rows
    page.drawLine({
      start: { x: MARGIN, y: cursor.y + 3 },
      end: { x: PAGE_W - MARGIN, y: cursor.y + 3 },
      thickness: 0.25,
      color: rgb(0.92, 0.92, 0.93),
    });
  }

  cursor.y -= 8;
  return page;
}
