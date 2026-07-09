// Line-marking differentiation — from the Multisport Overlay Spec (A4) and the
// Cricket + Football coexistence spec (B2). When several sports share one
// surface, lines are separated by unique COLOUR, PRIORITY (which line sits on
// top), and BREAKS where a lower-priority line crosses a dominant one.

import type { Sport } from "./schema";
import { SPORT_LABEL } from "./schema";

export type LineStyle = { color: string; widthMm: number };

// Standard single-sport line colour + width (Sport England / governing-body
// convention; football/cricket per the time-shared build).
export const LINE_STYLE: Record<Sport, LineStyle> = {
  badminton: { color: "#FFFFFF", widthMm: 40 },
  basketball: { color: "#1E3A8A", widthMm: 50 }, // dark blue (red is an alt)
  volleyball: { color: "#EAB308", widthMm: 50 }, // yellow
  pickleball: { color: "#15803D", widthMm: 50 }, // dark green (blue alt)
  tennis: { color: "#EA580C", widthMm: 50 }, // orange
  football: { color: "#FFFFFF", widthMm: 120 },
  cricket: { color: "#EAB308", widthMm: 50 }, // creases + boundary arc, yellow
  multisport: { color: "#FFFFFF", widthMm: 50 },
};

// Priority: fast, line-critical sports sit ON TOP; slower sports underneath.
// Lower index = higher priority (drawn last / on top, stays continuous).
export const LINE_PRIORITY: Sport[] = [
  "badminton",
  "tennis",
  "pickleball",
  "volleyball",
  "basketball",
  "cricket",
  "football",
  "multisport",
];

// Gap left on EACH side where a lower-priority line crosses a dominant line
// (so crossings stay readable). Spec: 19–25 mm (¾"–1").
export const LINE_BREAK_MM = 22;

// Distinct fallback colours used when two sports' standard colours clash.
const FALLBACK = ["#DC2626", "#2563EB", "#EAB308", "#15803D", "#EA580C", "#7C3AED", "#0EA5E9", "#111827"];

// Assign a DISTINCT colour to each sport on a shared surface (rule: no colour
// used for more than one sport). Keeps each sport's standard colour where it
// doesn't clash, else pulls the next unused fallback.
export function overlayPalette(sports: Sport[]): Record<string, string> {
  const ordered = [...sports].sort(
    (a, b) => LINE_PRIORITY.indexOf(a) - LINE_PRIORITY.indexOf(b),
  );
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const s of ordered) {
    let c = LINE_STYLE[s]?.color ?? "#FFFFFF";
    if (used.has(c.toUpperCase())) {
      c = FALLBACK.find((f) => !used.has(f.toUpperCase())) ?? c;
    }
    used.add(c.toUpperCase());
    out[s] = c;
  }
  return out;
}

export type LegendEntry = { sport: Sport; label: string; color: string; widthMm: number };

// A colour legend mapping each sport to its (clash-resolved) line colour, in
// priority order — rendered on multi-sport / time-shared designs.
export function buildLegend(sports: Sport[]): LegendEntry[] {
  const palette = overlayPalette(sports);
  return [...sports]
    .sort((a, b) => LINE_PRIORITY.indexOf(a) - LINE_PRIORITY.indexOf(b))
    .map((s) => ({
      sport: s,
      label: SPORT_LABEL[s] ?? s,
      color: palette[s],
      widthMm: LINE_STYLE[s]?.widthMm ?? 50,
    }));
}

// For a time-shared cricket + football box: football is the primary white
// line set, cricket creases/boundary in yellow (spec B2). Returns the two
// distinct colours to use.
export function cricketFootballColors(): { football: string; cricket: string } {
  return { football: "#FFFFFF", cricket: "#EAB308" };
}
