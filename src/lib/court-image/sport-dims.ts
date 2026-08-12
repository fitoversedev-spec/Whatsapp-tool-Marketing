// P4-03 — Canonical sport-dimension registry.
//
// Before this file, court sizes were duplicated across FOUR places with subtly
// different values, and it was easy to accidentally collapse two DIFFERENT
// footprints into one:
//   * packing.ts PACKING_PRESETS  — the CAPACITY footprint (feeds
//     predictCapacity → courtCapacity → live quotes). MUST NOT change.
//   * schema.ts COURT_REG         — the tiling footprint (retileCourts).
//   * schema.ts REG (concentric)  — the multisport concentric-stack size.
//   * schema.ts playSizes[a-side] — the drawn football pitch size.
//
// The single most important invariant (cross-verified 2026-08-11): for
// FOOTBALL the CAPACITY footprint is the 7-a-side representative pitch
// (60 × 40 m ≈ 197 × 131 ft), which is DISTINCT from the 11-a-side DRAWING
// size (~105 × 68 m ≈ 344 × 223 ft). Collapsing capacity to the drawing size
// would silently change predictCapacity → the capacity banner → the quote.
// So this registry keeps `capacity` and `drawing` SEPARATE per sport.
//
// This module intentionally has NO runtime imports (only a type-only import of
// Sport) so it can be consumed by both schema.ts and packing.ts without
// creating an import cycle (schema.ts already imports predictCapacity from
// packing.ts at runtime).

import type { Sport } from "./schema";

export type SportDims = {
  // CAPACITY / packing footprint (playing area used by predictCapacity and
  // retileCourts). Feeds live quotes for football via courtCapacity — treat as
  // frozen; changing it re-baselines every quote. Values here are byte-for-byte
  // the pl/pw that packing.ts used as literals before P4-03.
  capacity: { l: number; w: number };
  // Nominal DRAWING size (regulation playing area) used for the multisport
  // concentric stack + solo-court aspect ratio. Only ever read at layout-build
  // time and baked into element width/height, so changing it affects NEW
  // layouts only — never a previously-saved layout.
  drawing: { l: number; w: number };
};

// Long × short (ft). See per-field notes above for which value feeds what.
//
// NOTE on football's two ~344 drawing values: the concentric-stack `drawing`
// here is 344 × 223 (matches the historical REG literal exactly, so no render
// changes), while the solo 11-a-side pitch uses FOOTBALL_PLAY_SIZES[11] =
// 344.49 × 223.1 (the exact 105 × 68 m conversion). Both are captured in one
// place now; unifying them to a single value is deferred because it would
// alter new concentric-multisport-football renders and this phase mandates
// zero render change outside the intended IFAB fixes (P4-05).
export const SPORT_DIMS = {
  football: { capacity: { l: 197, w: 131 }, drawing: { l: 344, w: 223 } },
  basketball: { capacity: { l: 91.86, w: 49.21 }, drawing: { l: 91.86, w: 49.21 } },
  tennis: { capacity: { l: 78, w: 36 }, drawing: { l: 78, w: 36 } },
  volleyball: { capacity: { l: 59.06, w: 29.53 }, drawing: { l: 59, w: 30 } },
  pickleball: { capacity: { l: 44, w: 20 }, drawing: { l: 44, w: 20 } },
  badminton: { capacity: { l: 43.96, w: 20.01 }, drawing: { l: 44, w: 20 } },
} satisfies Partial<Record<Sport, SportDims>>;

// Drawn football pitch playing area (ft) per format — exact metric → ft so the
// drawn pitch matches the governing-body size to < 0.1 m:
//   5-a-side  : FIFA futsal 40 × 20 m
//   7-a-side  : FA 54.86 × 36.58 m
//   11-a-side : FIFA/IFAB 105 × 68 m
// Byte-identical to the previous inline playSizes literal in buildInitialLayout.
export const FOOTBALL_PLAY_SIZES: Record<5 | 7 | 11, { l: number; w: number }> = {
  5: { l: 131.23, w: 65.62 },
  7: { l: 180, w: 120 },
  11: { l: 344.49, w: 223.1 },
};
