// One-shot PDF generator for the Court Design Reference + Customer
// Information Checklist. Re-run anytime the content changes:
//
//   npx tsx scripts/generate-court-designer-guide.ts
//
// Writes to public/court-designer-guide.pdf so the file is downloadable
// from the live app at /court-designer-guide.pdf.
//
// Built on pdf-lib (the same dep the quotation PDF uses) so there are no
// new runtime dependencies — Helvetica StandardFonts only encode WinAnsi,
// so all the special chars (smart quotes, en/em dash, ≥ ✓ etc.) go
// through sanitize() before drawing.

// No dotenv — this script doesn't read env vars; the project lives under
// OneDrive which intermittently locks node_modules and the cold-load of
// any module can fail with errno -4094. Keeping imports minimal helps.
import * as fs from "fs";
import * as path from "path";
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

const BLACK = rgb(0.06, 0.09, 0.16);
const SLATE = rgb(0.4, 0.46, 0.55);
const SLATE_LIGHT = rgb(0.6, 0.65, 0.72);
const GREEN = rgb(0.18, 0.55, 0.34);
const GREEN_LIGHT = rgb(0.85, 0.93, 0.88);
const LINE = rgb(0.85, 0.88, 0.92);
const WHITE = rgb(1, 1, 1);

// Helvetica StandardFonts only encode the WinAnsi (Western European)
// character range. The reference text uses ₹, ≥, smart quotes, en/em
// dashes, ✓ etc. — strip or replace each before rendering.
function sanitize(text: string): string {
  return text
    .replace(/₹/g, "Rs.")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[•●]/g, "*")
    .replace(/✓/g, "[v]")
    .replace(/✗/g, "[x]")
    .replace(/[ ]/g, " ")
    .replace(/[…]/g, "...")
    // Strip any remaining non-ASCII (covers stray emoji etc.)
    .replace(/[^\x20-\x7E\n]/g, "");
}

type Ctx = {
  doc: PDFDocument;
  font: PDFFont;
  fontBold: PDFFont;
  page: PDFPage;
  y: number;
  pageNumber: number;
  logoImg: import("pdf-lib").PDFImage | null;
};

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([A4_WIDTH, A4_HEIGHT]);
  ctx.y = A4_HEIGHT - MARGIN;
  ctx.pageNumber += 1;
  drawHeaderFooter(ctx);
}

function drawHeaderFooter(ctx: Ctx) {
  // Tiny brand strip at the top + page number at the bottom on every
  // page after the cover.
  if (ctx.pageNumber > 1) {
    ctx.page.drawText(sanitize("Fitoverse - Court Design Reference"), {
      x: MARGIN,
      y: A4_HEIGHT - 24,
      size: 8,
      font: ctx.font,
      color: SLATE_LIGHT,
    });
    ctx.page.drawLine({
      start: { x: MARGIN, y: A4_HEIGHT - 30 },
      end: { x: A4_WIDTH - MARGIN, y: A4_HEIGHT - 30 },
      thickness: 0.5,
      color: LINE,
    });
    ctx.page.drawText(`Page ${ctx.pageNumber}`, {
      x: A4_WIDTH - MARGIN - 36,
      y: 22,
      size: 8,
      font: ctx.font,
      color: SLATE_LIGHT,
    });
  }
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 28) {
    newPage(ctx);
  }
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawLine(
  ctx: Ctx,
  text: string,
  opts: {
    size?: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    indent?: number;
    after?: number;
  } = {}
) {
  const size = opts.size ?? 10.5;
  const font = opts.bold ? ctx.fontBold : ctx.font;
  const color = opts.color ?? BLACK;
  const indent = opts.indent ?? 0;
  const x = MARGIN + indent;
  const maxWidth = CONTENT_WIDTH - indent;
  const lines = wrapText(sanitize(text), font, size, maxWidth);
  for (const line of lines) {
    ensureSpace(ctx, size + 3);
    ctx.page.drawText(line, { x, y: ctx.y - size, size, font, color });
    ctx.y -= size + 3;
  }
  if (opts.after) ctx.y -= opts.after;
}

function heading1(ctx: Ctx, text: string) {
  ctx.y -= 14;
  ensureSpace(ctx, 36);
  // Green accent bar to the left of the heading text
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 18,
    width: 4,
    height: 22,
    color: GREEN,
  });
  drawLine(ctx, text, {
    size: 18,
    bold: true,
    color: GREEN,
    indent: 12,
    after: 6,
  });
}

function heading2(ctx: Ctx, text: string) {
  ctx.y -= 6;
  ensureSpace(ctx, 18);
  drawLine(ctx, text, { size: 13, bold: true, after: 3 });
}

function paragraph(ctx: Ctx, text: string, after = 4) {
  drawLine(ctx, text, { after });
}

function bullet(ctx: Ctx, text: string) {
  drawLine(ctx, `* ${text}`, { indent: 14, after: 1 });
}

function checkbox(ctx: Ctx, text: string) {
  // Manual checkbox rectangle + text so it looks like a real form to
  // tick off during a sales call, not "[ ]" text.
  ensureSpace(ctx, 14);
  ctx.page.drawRectangle({
    x: MARGIN + 12,
    y: ctx.y - 11,
    width: 9,
    height: 9,
    borderColor: SLATE,
    borderWidth: 0.8,
    color: WHITE,
  });
  ctx.page.drawText(sanitize(text), {
    x: MARGIN + 28,
    y: ctx.y - 10,
    size: 10.5,
    font: ctx.font,
    color: BLACK,
  });
  ctx.y -= 16;
}

// Simple 2-column table for "Type | Dimensions | Best for" style data.
// Auto-wraps row text within each column.
function drawTable(
  ctx: Ctx,
  headers: string[],
  rows: string[][],
  widthRatios?: number[]
) {
  const cols = headers.length;
  const ratios = widthRatios ?? new Array(cols).fill(1);
  const totalRatio = ratios.reduce((s, r) => s + r, 0);
  const colWidths = ratios.map((r) => (CONTENT_WIDTH * r) / totalRatio);
  const colXs = [MARGIN];
  for (let i = 1; i < cols; i++) {
    colXs[i] = colXs[i - 1] + colWidths[i - 1];
  }

  ensureSpace(ctx, 30);
  // Header background strip
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 16,
    width: CONTENT_WIDTH,
    height: 18,
    color: GREEN_LIGHT,
  });
  for (let i = 0; i < cols; i++) {
    ctx.page.drawText(sanitize(headers[i]), {
      x: colXs[i] + 6,
      y: ctx.y - 11,
      size: 9,
      font: ctx.fontBold,
      color: GREEN,
    });
  }
  ctx.y -= 20;

  for (const row of rows) {
    let maxLines = 1;
    const cellLines: string[][] = [];
    for (let i = 0; i < cols; i++) {
      const lines = wrapText(
        sanitize(row[i] ?? ""),
        ctx.font,
        10,
        colWidths[i] - 12
      );
      cellLines.push(lines);
      maxLines = Math.max(maxLines, lines.length);
    }
    const rowHeight = maxLines * 12 + 6;
    ensureSpace(ctx, rowHeight + 2);
    for (let i = 0; i < cols; i++) {
      let yy = ctx.y - 11;
      for (const line of cellLines[i]) {
        ctx.page.drawText(line, {
          x: colXs[i] + 6,
          y: yy,
          size: 10,
          font: ctx.font,
          color: BLACK,
        });
        yy -= 12;
      }
    }
    ctx.y -= rowHeight;
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y + 2 },
      end: { x: MARGIN + CONTENT_WIDTH, y: ctx.y + 2 },
      thickness: 0.3,
      color: LINE,
    });
  }
  ctx.y -= 6;
}

function drawCover(ctx: Ctx) {
  // Big centered title block with the Fitoverse logo (if available) and
  // a subtitle. Designed to look like a proper document cover.
  const title = "Court Design Reference";
  const subtitle = "Sport-by-sport build guide + customer questionnaire";

  // Background hero rectangle
  ctx.page.drawRectangle({
    x: 0,
    y: A4_HEIGHT - 340,
    width: A4_WIDTH,
    height: 340,
    color: GREEN_LIGHT,
  });

  // Logo
  if (ctx.logoImg) {
    const targetW = 140;
    const targetH = (ctx.logoImg.height / ctx.logoImg.width) * targetW;
    ctx.page.drawImage(ctx.logoImg, {
      x: (A4_WIDTH - targetW) / 2,
      y: A4_HEIGHT - 200,
      width: targetW,
      height: targetH,
    });
  }

  // Title
  const titleSize = 28;
  const titleW = ctx.fontBold.widthOfTextAtSize(sanitize(title), titleSize);
  ctx.page.drawText(sanitize(title), {
    x: (A4_WIDTH - titleW) / 2,
    y: A4_HEIGHT - 270,
    size: titleSize,
    font: ctx.fontBold,
    color: BLACK,
  });

  // Subtitle
  const subSize = 12;
  const subW = ctx.font.widthOfTextAtSize(sanitize(subtitle), subSize);
  ctx.page.drawText(sanitize(subtitle), {
    x: (A4_WIDTH - subW) / 2,
    y: A4_HEIGHT - 300,
    size: subSize,
    font: ctx.font,
    color: SLATE,
  });

  // Bottom credit
  const credit = "Fitoverse - Sports Infrastructure";
  const creditW = ctx.font.widthOfTextAtSize(sanitize(credit), 10);
  ctx.page.drawText(sanitize(credit), {
    x: (A4_WIDTH - creditW) / 2,
    y: 60,
    size: 10,
    font: ctx.font,
    color: SLATE,
  });

  const date = new Date().toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
  });
  const dateW = ctx.font.widthOfTextAtSize(sanitize(date), 9);
  ctx.page.drawText(sanitize(date), {
    x: (A4_WIDTH - dateW) / 2,
    y: 44,
    size: 9,
    font: ctx.font,
    color: SLATE_LIGHT,
  });
}

// ─────────────────────────────────────────────────────────────────────
//  Content
// ─────────────────────────────────────────────────────────────────────

type Sport = {
  title: string;
  intro?: string;
  courtTypes: {
    headers: string[];
    rows: string[][];
    widthRatios?: number[];
  };
  sections: Array<{ heading: string; bullets: string[] }>;
};

const SPORTS: Sport[] = [
  {
    title: "Football Turf",
    intro:
      "Most-requested build for Fitoverse — used for box-turf rentals, residential societies, schools, and full-size 11-a-side grounds. Surface choice and infill dominate the quote.",
    courtTypes: {
      headers: ["Type", "Length x Width", "Best for"],
      rows: [
        ["5-a-side", "25-42m x 15-25m (82-138ft x 49-82ft)", "Box turf / fitness / residential"],
        ["7-a-side", "50-65m x 30-45m (164-213ft x 98-148ft)", "Standard commercial turf"],
        ["11-a-side (club)", "100-110m x 64-75m (328-360ft x 210-245ft)", "School / club ground"],
        ["11-a-side (FIFA)", "105m x 68m (344ft x 223ft)", "Tournament grade"],
      ],
      widthRatios: [1, 2, 1.5],
    },
    sections: [
      {
        heading: "Surface / turf options",
        bullets: [
          "40mm artificial grass - entry level, kids facilities",
          "50mm 3rd-generation grass - most common standard",
          "60mm professional turf - FIFA-quality",
          "Natural grass - high maintenance, premium clubs",
          "Hybrid grass - natural + synthetic strands",
        ],
      },
      {
        heading: "Infill",
        bullets: [
          "SBR rubber granules - default in India, lowest cost",
          "TPE granules - eco-friendly, higher cost",
          "Cork + coconut fibre - premium, no heat retention",
          "Sand only - cheapest, hot surface",
        ],
      },
      {
        heading: "Sub-base",
        bullets: [
          "Compacted earth + sand + gravel - entry-level",
          "Concrete base - premium, drains well",
          "Shock-pad layer (~10mm) - FIFA-recommended",
        ],
      },
      {
        heading: "Goal posts (per a-side)",
        bullets: [
          "5-a-side: 12ft x 6ft",
          "7-a-side: 16ft x 7ft",
          "11-a-side: 24ft x 8ft (regulation)",
        ],
      },
      {
        heading: "Equipment & fixtures",
        bullets: [
          "Goal nets (3mm or 4mm polyester)",
          "Corner flags",
          "Substitution boards",
          "Dugouts (covered team benches)",
          "Spectator benches",
        ],
      },
      {
        heading: "Fencing",
        bullets: [
          "Chain-link 8-12ft (basic)",
          "Welded mesh (premium)",
          "Gate width: 8-10ft",
        ],
      },
      {
        heading: "Lighting (outdoor)",
        bullets: [
          "LED flood: 200-400W per pole",
          "Pole height: 6-12m",
          "Lux: 200-500 (amateur), 500-1500 (tournament)",
        ],
      },
    ],
  },
  {
    title: "Cricket",
    intro:
      "Common in India as box cricket, school grounds, and club outfields. Pitch length is the most varied parameter — sales should confirm before quoting.",
    courtTypes: {
      headers: ["Type", "Pitch", "Boundary"],
      rows: [
        ["Box cricket", "12 yd (36ft)", "60-80ft x 30-50ft enclosed"],
        ["Compact net cricket", "22 yd (66ft)", "Narrow enclosed"],
        ["Junior ground", "22 yd", "50-60m boundary"],
        ["Club ground", "22 yd", "65-75m boundary"],
        ["International", "22 yd", "75-90m boundary"],
      ],
    },
    sections: [
      {
        heading: "Pitch length variants",
        bullets: [
          "Regulation - 22 yd (66ft)",
          "Senior-junior - 18 yd (54ft)",
          "Youth - 16 yd (48ft)",
          "Compact / box - 12 yd (36ft)",
          "Kids - 9 yd (27ft)",
        ],
      },
      {
        heading: "Pitch surface",
        bullets: [
          "Cement concrete - most durable, common in India",
          "Astro turf pitch mat - low maintenance",
          "Coir matting - traditional, removable",
          "Synthetic matting - affordable",
          "Clay - premium, requires roller + maintenance",
        ],
      },
      {
        heading: "Outfield",
        bullets: [
          "Natural grass (roller + irrigation)",
          "50mm artificial turf",
          "Mixed (turf outfield + cement pitch)",
        ],
      },
      {
        heading: "Equipment",
        bullets: [
          "Stumps (3 per end, 28in tall)",
          "Bails (4in)",
          "Sight screens (white, 12ft x 8ft)",
          "Boundary rope or markers",
        ],
      },
      {
        heading: "Fencing",
        bullets: [
          "Cricket netting 25-30ft (for box cricket)",
          "Chain-link perimeter (open ground)",
          "Roof netting (full enclosure)",
        ],
      },
    ],
  },
  {
    title: "Basketball",
    intro:
      "Half-court 3-on-3 dominates Indian residential and school builds; full-court 5-on-5 only for serious clubs. Hoop type and backboard material drive the quote.",
    courtTypes: {
      headers: ["Type", "Dimensions", "Best for"],
      rows: [
        ["3-on-3 / FIBA half-court", "12.5m x 15m (41ft x 49.2ft)", "Schools / clubs / events"],
        ["Junior half-court", "30-40ft x 25-35ft", "Residential / kids"],
        ["Driveway / recreational", "30-50ft x 20-30ft", "Home use"],
        ["5-on-5 FIBA full", "28m x 15m (91.86ft x 49.2ft)", "Commercial / tournament"],
        ["5-on-5 NBA full", "94ft x 50ft", "Premium"],
      ],
      widthRatios: [1.4, 1.6, 1.5],
    },
    sections: [
      {
        heading: "Surface options",
        bullets: [
          "Acrylic outdoor - most common (sports paint over concrete)",
          "PVC / vinyl roll - indoor",
          "PU (polyurethane) sports flooring - premium indoor",
          "Wooden parquet - premium indoor (pro arenas)",
          "Modular interlocking tiles - portable, rapid install",
          "Concrete only - cheapest, hard on joints",
        ],
      },
      {
        heading: "Sub-base",
        bullets: [
          "Concrete slab - industry standard, must be cured + level",
          "Asphalt - cheaper, cracks faster",
        ],
      },
      {
        heading: "Surface colors",
        bullets: [
          "FIBA blue + red (pro look)",
          "Single tone (any color)",
          "Multi-zone (3-point area highlighted)",
        ],
      },
      {
        heading: "Hoop options",
        bullets: [
          "In-ground concrete-mounted - permanent, club / school",
          "Portable with sand/water base - driveways, temporary",
          "Wall-mounted - indoor halls, gymnasiums",
          "Adjustable (7-10ft) - kids / mixed-age",
          "Fixed regulation 10ft - adult / tournament",
        ],
      },
      {
        heading: "Backboard",
        bullets: [
          "Tempered glass - premium, 6ft x 3.5ft",
          "Polycarbonate / acrylic - outdoor",
          "Steel mesh - cheap, kids only",
        ],
      },
      {
        heading: "Equipment",
        bullets: [
          "Rim (18in, 10ft from ground)",
          "Spring rim (dunk-safe)",
          "Nylon net (21in)",
          "Scoreboard (manual or electronic)",
        ],
      },
      {
        heading: "Fencing",
        bullets: ["Mesh / chain-link 12-15ft (ball containment)"],
      },
    ],
  },
  {
    title: "Pickleball",
    intro:
      "Fastest-growing racquet sport in urban India. Court is small (20ft x 44ft) — fits in driveways and rooftops.",
    courtTypes: {
      headers: ["Type", "Court", "Total area (with buffer)"],
      rows: [
        ["Singles", "20ft x 44ft", "30ft x 60ft"],
        ["Doubles", "20ft x 44ft (same)", "30ft x 60ft"],
        ["Tournament", "20ft x 44ft", "34ft x 64ft (full run-off)"],
      ],
    },
    sections: [
      {
        heading: "Surface",
        bullets: [
          "Acrylic sports surface - most common",
          "Cushioned acrylic - premium, easier on joints",
          "Concrete only - basic",
          "Asphalt + acrylic topcoat - durable mid-range",
          "Modular tiles - portable",
        ],
      },
      {
        heading: "Equipment",
        bullets: [
          "Net: 22ft wide, 36in at posts, 34in at center",
          "Posts (steel, in-ground)",
          "Paddles + balls (not part of build)",
        ],
      },
      {
        heading: "Fencing",
        bullets: ["Chain-link 10ft"],
      },
    ],
  },
  {
    title: "Tennis",
    intro:
      "Premium build. Indian outdoor builds default to hard-court acrylic; clay is rare. Junior variants exist for kids' coaching academies.",
    courtTypes: {
      headers: ["Type", "Court", "Recommended total"],
      rows: [
        ["Singles", "27ft x 78ft", "60ft x 120ft"],
        ["Doubles", "36ft x 78ft", "60ft x 120ft"],
        ["Junior 10U (red ball)", "18ft x 60ft", "-"],
        ["Junior 12U (orange ball)", "23ft x 78ft", "-"],
      ],
    },
    sections: [
      {
        heading: "Surface",
        bullets: [
          "Hard court / acrylic - most common in India",
          "Cushioned acrylic - premium",
          "Clay (red or green) - slow, European style",
          "Grass - traditional, Wimbledon style",
          "Synthetic grass - recreational",
        ],
      },
      {
        heading: "Equipment",
        bullets: [
          "Net: 42in at posts, 36in at center",
          "Umpire chair (tournament)",
        ],
      },
    ],
  },
  {
    title: "Badminton",
    intro:
      "Mostly indoor. Ceiling height is critical (25ft minimum). PVC vinyl mat is the workhorse surface.",
    courtTypes: {
      headers: ["Type", "Court"],
      rows: [
        ["Singles", "17ft x 44ft"],
        ["Doubles", "20ft x 44ft (same court, different lines)"],
        ["Minimum ceiling height (indoor)", "25ft"],
      ],
      widthRatios: [1.4, 2],
    },
    sections: [
      {
        heading: "Surface",
        bullets: [
          "Wooden parquet - premium",
          "PVC vinyl mat - most common in India",
          "Synthetic acrylic",
          "Cushioned PU sports flooring - pro",
        ],
      },
      {
        heading: "Equipment",
        bullets: [
          "Net: 20ft wide, 5ft at posts, 5ft 1in at center",
          "Posts (5ft 1in)",
        ],
      },
    ],
  },
  {
    title: "Volleyball",
    intro:
      "Indoor regulation, beach, and recreational variants. Beach builds need 30cm sand depth.",
    courtTypes: {
      headers: ["Type", "Dimensions"],
      rows: [
        ["Indoor regulation", "29.5ft x 59ft (9m x 18m)"],
        ["Beach volleyball", "26.25ft x 52.5ft (8m x 16m)"],
        ["Recreational", "Smaller variants accepted"],
      ],
    },
    sections: [
      {
        heading: "Surface",
        bullets: [
          "Wooden floor (indoor pro)",
          "PU sports flooring (indoor)",
          "PVC sports flooring (indoor)",
          "Sand (beach, 30cm depth)",
          "Synthetic grass (recreational outdoor)",
        ],
      },
      {
        heading: "Equipment",
        bullets: [
          "Net: 7ft 11.6in (men), 7ft 4.2in (women)",
          "Steel posts, padded",
        ],
      },
    ],
  },
  {
    title: "Multisport (combined facility)",
    intro:
      "Box-turf operators almost always want football + cricket on the same surface. Indoor halls combine badminton + basketball + volleyball.",
    courtTypes: {
      headers: ["Combination", "Why"],
      rows: [
        ["Football + Cricket", "Most common box-turf combo, shares artificial turf"],
        ["Basketball + Pickleball", "Same rectangular acrylic court"],
        ["Tennis + Pickleball", "Same court dimensions, just relined"],
        ["Football + Basketball + Volleyball", "Large multi-purpose ground"],
        ["Badminton + Basketball + Volleyball", "Indoor sports hall"],
      ],
      widthRatios: [1.5, 2],
    },
    sections: [
      {
        heading: "Surface compromise",
        bullets: [
          "Artificial turf works for football + cricket",
          "Acrylic works for basketball + tennis + pickleball + volleyball",
          "Wooden / PU works for badminton + basketball (indoor)",
        ],
      },
      {
        heading: "Marking strategy",
        bullets: [
          "Color-coded lines per sport (white for primary, yellow/red for secondary)",
          "Legend printed on sidewall",
        ],
      },
    ],
  },
];

type ChecklistSection = {
  title: string;
  items: string[];
  conditional?: { triggeredBy: string; items: string[] }[];
};

const CHECKLIST: ChecklistSection[] = [
  {
    title: "A - Site basics",
    items: [
      "Plot length (ft)",
      "Plot width (ft)",
      "Plot shape (rectangle / square / irregular)",
      "Indoor or outdoor",
      "Ceiling height (if indoor)",
      "Existing sub-base (concrete / asphalt / earth / none)",
      "Drainage gradient available?",
      "Sunlight exposure (full / partial / shaded)",
    ],
  },
  {
    title: "B - Use case",
    items: [
      "Primary sport (single or multi-select)",
      "Secondary sports (if multisport)",
      "Age group (kids / adults / mixed)",
      "Use type (commercial rental / society / school / club / personal)",
      "Expected daily usage hours",
      "Tournament-grade required?",
    ],
  },
  {
    title: "C - Sport-specific config",
    items: [],
    conditional: [
      {
        triggeredBy: "If Football",
        items: [
          "A-side preset (5 / 7 / 11)",
          "Turf grade (40mm / 50mm / 60mm / natural)",
          "Infill type",
          "Goal post size",
          "Dugouts required?",
        ],
      },
      {
        triggeredBy: "If Cricket",
        items: [
          "Pitch length (22yd / 18yd / 16yd / 12yd / custom)",
          "Pitch surface (cement / astro turf mat / coir / clay)",
          "Box cricket (enclosed) or open ground?",
          "Sight screens?",
        ],
      },
      {
        triggeredBy: "If Basketball",
        items: [
          "Court type (3-on-3 / 5-on-5 half / 5-on-5 full)",
          "Surface (acrylic / PU / wooden / tiles)",
          "Hoop type (in-ground / portable / wall-mounted / adjustable)",
          "Backboard material (glass / acrylic / steel)",
          "Scoreboard required?",
        ],
      },
      {
        triggeredBy: "If Pickleball / Tennis / Badminton / Volleyball",
        items: [
          "Singles / doubles markings",
          "Net type",
          "Surface preference",
        ],
      },
      {
        triggeredBy: "If Multisport",
        items: [
          "List sports in priority order",
          "Confirm surface compromise acceptable",
        ],
      },
    ],
  },
  {
    title: "D - Perimeter",
    items: [
      "Fence height (8 / 10 / 12 / 15 ft)",
      "Fence material (chain-link / welded mesh / netting)",
      "Gate location (north / south / east / west)",
      "Gate width",
      "Roof netting required?",
    ],
  },
  {
    title: "E - Lighting (outdoor)",
    items: [
      "Night play required?",
      "LED flood-light count",
      "Pole height",
      "Lux target",
    ],
  },
  {
    title: "F - Add-ons",
    items: [
      "Dugouts (count)",
      "Scoreboard (manual / electronic)",
      "Spectator seating (count)",
      "Changing rooms",
      "Washrooms",
      "Storage room",
      "Drinking water station",
    ],
  },
  {
    title: "G - Branding",
    items: [
      "Court name (e.g. 'Court 1')",
      "Sponsor logos on perimeter?",
      "Customer logo on court center?",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────
//  Render
// ─────────────────────────────────────────────────────────────────────

async function main() {
  const doc = await PDFDocument.create();
  doc.setTitle("Fitoverse Court Design Reference");
  doc.setAuthor("Fitoverse");
  doc.setSubject("Sport-by-sport build guide + customer questionnaire");
  doc.setCreator("Fitoverse WhatsApp Tool");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Try to embed the Fitoverse logo for the cover. Same path the
  // quotation PDF uses; if missing, the cover degrades gracefully.
  let logoImg: import("pdf-lib").PDFImage | null = null;
  try {
    const logoBytes = fs.readFileSync(
      path.join(process.cwd(), "public", "quotation-assets", "image1.png")
    );
    logoImg = await doc.embedPng(logoBytes);
  } catch {
    console.warn("Logo not found at public/quotation-assets/image1.png");
  }

  const ctx: Ctx = {
    doc,
    font,
    fontBold,
    page: null as unknown as PDFPage,
    y: 0,
    pageNumber: 0,
    logoImg,
  };

  // Cover page
  newPage(ctx);
  drawCover(ctx);

  // Table of contents
  newPage(ctx);
  heading1(ctx, "Contents");
  let tocNum = 1;
  for (const s of SPORTS) {
    drawLine(ctx, `${tocNum}.  ${s.title}`, { size: 11, after: 2 });
    tocNum += 1;
  }
  drawLine(ctx, `${tocNum}.  Customer Information Checklist`, {
    size: 11,
    bold: true,
    color: GREEN,
    after: 4,
  });

  // Sport sections
  for (const sport of SPORTS) {
    heading1(ctx, sport.title);
    if (sport.intro) {
      paragraph(ctx, sport.intro, 4);
    }
    heading2(ctx, "Court types");
    drawTable(
      ctx,
      sport.courtTypes.headers,
      sport.courtTypes.rows,
      sport.courtTypes.widthRatios
    );
    for (const section of sport.sections) {
      heading2(ctx, section.heading);
      for (const b of section.bullets) bullet(ctx, b);
    }
  }

  // Customer information checklist
  heading1(ctx, "Customer Information Checklist");
  paragraph(
    ctx,
    "Use this on the first sales call. Fill it out alongside the customer - the answers feed directly into the Court Designer wizard in the tool.",
    6
  );
  for (const section of CHECKLIST) {
    heading2(ctx, section.title);
    for (const item of section.items) checkbox(ctx, item);
    if (section.conditional) {
      for (const cond of section.conditional) {
        ctx.y -= 4;
        drawLine(ctx, cond.triggeredBy, {
          size: 11,
          bold: true,
          color: SLATE,
          after: 2,
        });
        for (const item of cond.items) checkbox(ctx, item);
      }
    }
  }

  // Closing page note
  ctx.y -= 14;
  ensureSpace(ctx, 60);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 48,
    width: CONTENT_WIDTH,
    height: 50,
    color: GREEN_LIGHT,
  });
  ctx.page.drawText(sanitize("Ready to design?"), {
    x: MARGIN + 12,
    y: ctx.y - 18,
    size: 13,
    font: fontBold,
    color: GREEN,
  });
  ctx.page.drawText(
    sanitize(
      "Open the WhatsApp tool, click Court Designer, and walk through the wizard."
    ),
    {
      x: MARGIN + 12,
      y: ctx.y - 36,
      size: 10,
      font: ctx.font,
      color: BLACK,
    }
  );

  const bytes = await doc.save();
  const outPath = path.join(process.cwd(), "public", "court-designer-guide.pdf");
  fs.writeFileSync(outPath, bytes);
  const sizeKb = Math.round(bytes.length / 1024);
  const pages = doc.getPageCount();
  console.log(`OK  Wrote ${outPath}`);
  console.log(`    ${pages} pages, ${sizeKb} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
