// Court-packing / capacity predictor — from the Multisport Overlay + Court-
// Packing Spec (Part B). For any plot L × W it returns how many courts of a
// sport fit WITH RUN-OFF INCLUDED, across both orientations, at two presets:
//   - competition  → full governing-body run-off  (lower bound)
//   - recreational → tight-but-playable run-off    (upper bound)
// Report the range, never a single forced number, and flag tight run-off.
//
// All values in FEET (the tool's unit). Presets converted from the spec's
// metres (1 m = 3.281 ft). margin = perimeter clearance each outer edge;
// gap = clear space between two adjacent courts.

import type { Sport } from "./schema";

export type PackingPreset = {
  /** Playing length × width, feet. */
  pl: number;
  pw: number;
  compMargin: number;
  compGap: number;
  recMargin: number;
  recGap: number;
};

const M = 3.281;

export const PACKING_PRESETS: Partial<Record<Sport, PackingPreset>> = {
  badminton: { pl: 43.96, pw: 20.01, compMargin: 2.3 * M, compGap: 2.0 * M, recMargin: 1.0 * M, recGap: 1.2 * M },
  pickleball: { pl: 44, pw: 20, compMargin: 3.05 * M, compGap: 2.4 * M, recMargin: 1.5 * M, recGap: 1.5 * M },
  tennis: { pl: 78, pw: 36, compMargin: 6.4 * M, compGap: 4.3 * M, recMargin: 5.5 * M, recGap: 3.66 * M },
  basketball: { pl: 91.86, pw: 49.21, compMargin: 2.0 * M, compGap: 2.0 * M, recMargin: 1.0 * M, recGap: 1.0 * M },
  volleyball: { pl: 59.06, pw: 29.53, compMargin: 5.0 * M, compGap: 3.0 * M, recMargin: 3.0 * M, recGap: 3.0 * M },
  football: { pl: 197, pw: 131, compMargin: 2.0 * M, compGap: 2.0 * M, recMargin: 1.5 * M, recGap: 1.5 * M },
};

// Courts fit along a wall-to-wall dimension D: n·c + (n−1)·gap + 2·margin ≤ D
// → n = floor((D − 2·margin + gap) / (c + gap)).
function fit1D(D: number, c: number, margin: number, gap: number): number {
  return Math.max(0, Math.floor((D - 2 * margin + gap) / (c + gap)));
}

function packCount(
  L: number,
  W: number,
  cl: number,
  cw: number,
  margin: number,
  gap: number,
): number {
  const o1 = fit1D(L, cl, margin, gap) * fit1D(W, cw, margin, gap);
  const o2 = fit1D(L, cw, margin, gap) * fit1D(W, cl, margin, gap);
  return Math.max(o1, o2);
}

export type CapacityResult = {
  /** Realistic max — tiles fit at the recreational preset. */
  recreational: number;
  /** Governing-body run-off — the conservative count. */
  competition: number;
  /** Whether the recreational count needs sub-standard (tight) run-off. */
  tight: boolean;
};

// How many courts of `sport` fit in the plot, at both presets.
export function predictCapacity(
  plotLengthFt: number,
  plotWidthFt: number,
  sport: Sport,
): CapacityResult {
  const p = PACKING_PRESETS[sport];
  if (!p) return { recreational: 1, competition: 1, tight: false };
  const recreational = Math.max(
    1,
    packCount(plotLengthFt, plotWidthFt, p.pl, p.pw, p.recMargin, p.recGap),
  );
  const competition = packCount(
    plotLengthFt,
    plotWidthFt,
    p.pl,
    p.pw,
    p.compMargin,
    p.compGap,
  );
  return { recreational, competition, tight: recreational > competition };
}

// Sports ordered largest → smallest playing footprint, for "won't fit but a
// smaller sport will" suggestions.
const SIZE_ORDER: Sport[] = [
  "football",
  "tennis",
  "basketball",
  "volleyball",
  "pickleball",
  "badminton",
];

// If the requested sport fits ≤ 0 competition courts, suggest the largest
// SMALLER sport that fits more (recreational). Returns null if none better.
export function suggestSmallerSport(
  plotLengthFt: number,
  plotWidthFt: number,
  sport: Sport,
): { sport: Sport; count: number } | null {
  const idx = SIZE_ORDER.indexOf(sport);
  if (idx < 0) return null;
  for (let i = idx + 1; i < SIZE_ORDER.length; i++) {
    const alt = SIZE_ORDER[i];
    const cap = predictCapacity(plotLengthFt, plotWidthFt, alt);
    if (cap.recreational >= 1 && PACKING_PRESETS[alt]) {
      return { sport: alt, count: cap.recreational };
    }
  }
  return null;
}
