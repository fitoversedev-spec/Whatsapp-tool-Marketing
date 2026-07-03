// International standard court dimensions, sourced from the Ebaco
// reference chart Fitoverse uses with customers. Each entry has:
//   - label (Play Area / With Run-Off / Minimum)
//   - length + width in feet (canonical) plus mm for reference
//   - area in sq.ft (used in the wizard chip subtitle for "this is X sqft")
//
// The wizard's Step 1 dimensions section reads this and renders click-
// to-apply chips beneath the Length/Width inputs once the user picks a
// sport. Goal: stop asking sales to memorise "what's the FIBA play area
// width again?" — let them pick from authoritative options.

export type CourtPreset = {
  label: string;
  lengthFt: number;
  widthFt: number;
  lengthMm: number;
  widthMm: number;
  areaSqFt: number;
  // Optional sub-variant tag (e.g. "NBA", "FIBA"). Lets the UI group
  // basketball chips visually.
  variant?: string;
  // Optional one-line hint: "doubles", "10' L / 6' W margin", etc.
  hint?: string;
};

// Volleyball — Ebaco international standard
// Volleyball — FIVB indoor. Playing court 18 × 9 m, free zone 3 m all
// around (FIVB minimum). Total plot 24 × 15 m = 78 × 49 ft.
const VOLLEYBALL: CourtPreset[] = [
  {
    label: "FIVB standard",
    lengthFt: 78,
    widthFt: 49,
    lengthMm: 24000,
    widthMm: 15000,
    areaSqFt: 3822,
    hint: "FIVB 18 × 9 m + 3 m free zone",
  },
];

// Badminton
// Badminton — BWF regulation. Playing court (doubles) 13.4 × 6.1 m.
// Free zone: 2 m at ends + 1 m at sides = plot 17.4 × 8.1 m ≈ 57 × 27 ft.
const BADMINTON: CourtPreset[] = [
  {
    label: "BWF standard",
    lengthFt: 57,
    widthFt: 27,
    lengthMm: 17400,
    widthMm: 8100,
    areaSqFt: 1539,
    hint: "BWF 13.4 × 6.1 m + free zone",
  },
];

// Tennis — ITF regulation. Playing court (doubles) 23.77 × 10.97 m.
// Run-off: 6.4 m behind baselines + 3.66 m beyond sidelines
// = plot 36.6 × 18.3 m ≈ 120 × 60 ft.
const TENNIS: CourtPreset[] = [
  {
    label: "ITF standard",
    lengthFt: 120,
    widthFt: 60,
    lengthMm: 36600,
    widthMm: 18300,
    areaSqFt: 7200,
    hint: "ITF 23.77 × 10.97 m + run-off",
  },
];

// Basketball — the two options sales actually pitches. The full-court
// variant covers a regulation FIBA build (28 × 15 m playing area with
// 2 m run-off = 32 × 19 m plot); the half-court variant covers FIBA
// 3x3 Olympic (15 × 11 m playing area with 2 m run-off = 19 × 15 m).
// NBA + intermediate presets were dropped — the wizard's Full / Half
// Court buttons are the primary picker; these chips just let sales
// re-apply the two canonical plot sizes with one click.
const BASKETBALL: CourtPreset[] = [
  {
    label: "Full court",
    variant: "FIBA",
    lengthFt: 105,
    widthFt: 62,
    lengthMm: 32000,
    widthMm: 19000,
    areaSqFt: 6510,
    hint: "FIBA 32 × 19 m · 2 m run-off",
  },
  {
    label: "Half court",
    variant: "FIBA 3x3",
    lengthFt: 62,
    widthFt: 49,
    lengthMm: 19000,
    widthMm: 15000,
    areaSqFt: 3038,
    hint: "FIBA 3x3 Olympic · 2 m run-off",
  },
];

// Football — common Indian-market builds, not on the Ebaco chart.
// Kept here for parity so the wizard chip strip works for every sport.
// FIFA-recognised playing areas + 2 m safety run-off on all sides.
//   5-a-side  play 40 × 20 m → plot 44 × 24 m  ( 144 × 79 ft)
//   7-a-side  play 60 × 40 m → plot 64 × 44 m  ( 210 × 144 ft)
//   11-a-side play 105 × 68 m → plot 109 × 72 m ( 358 × 236 ft)
const FOOTBALL: CourtPreset[] = [
  {
    label: "5-a-side",
    lengthFt: 144,
    widthFt: 79,
    lengthMm: 44000,
    widthMm: 24000,
    areaSqFt: 11376,
    hint: "FIFA 40 × 20 m · 2 m run-off",
  },
  {
    label: "7-a-side",
    lengthFt: 210,
    widthFt: 144,
    lengthMm: 64000,
    widthMm: 44000,
    areaSqFt: 30240,
    hint: "FIFA 60 × 40 m · 2 m run-off",
  },
  {
    label: "11-a-side",
    lengthFt: 358,
    widthFt: 236,
    lengthMm: 109000,
    widthMm: 72000,
    areaSqFt: 84488,
    hint: "FIFA 105 × 68 m regulation · 2 m run-off",
  },
];

// Pickleball — USAPA singles + doubles + tournament
// Pickleball — IPA / USAPA official. Playing court is 44 × 20 ft (same
// for singles + doubles). We ship two plots: standard (30 × 60 ft, with
// 5 ft safety on each side) and tournament (34 × 64 ft, 7 ft × 10 ft
// safety), matching what IPA / USAPA recommend for competitive play.
const PICKLEBALL: CourtPreset[] = [
  {
    label: "Standard court",
    lengthFt: 60,
    widthFt: 30,
    lengthMm: 18290,
    widthMm: 9144,
    areaSqFt: 1800,
    hint: "IPA · 44 × 20 ft play + 5 ft safety zone",
  },
  {
    label: "Tournament court",
    lengthFt: 64,
    widthFt: 34,
    lengthMm: 19510,
    widthMm: 10360,
    areaSqFt: 2176,
    hint: "IPA tournament · full run-off",
  },
];

// Cricket — pitch + boundary radius variants
// Cricket — practice net + pitch. ICC / MCC regulation pitch is
// 20.12 × 3.05 m (66 × 10 ft). Practice net area adds ~6 m of bowling
// run-up + safety = 32 × 4 m plot (105 × 13 ft) with turf floor.
const CRICKET: CourtPreset[] = [
  {
    label: "Practice net + pitch",
    lengthFt: 105,
    widthFt: 13,
    lengthMm: 32000,
    widthMm: 4000,
    areaSqFt: 1365,
    hint: "ICC 20.12 m pitch + bowling run-up",
  },
];

// Multisport — typical combination plot sizes Indian box-turf operators
// use. These are starting points, not standards.
const MULTISPORT: CourtPreset[] = [
  {
    label: "Football + Cricket box",
    lengthFt: 100,
    widthFt: 60,
    lengthMm: 30480,
    widthMm: 18290,
    areaSqFt: 6000,
    hint: "Compact dual-sport turf",
  },
  {
    label: "Football + Cricket standard",
    lengthFt: 150,
    widthFt: 80,
    lengthMm: 45720,
    widthMm: 24380,
    areaSqFt: 12000,
  },
];

export const SPORT_STANDARDS: Record<string, CourtPreset[]> = {
  football: FOOTBALL,
  cricket: CRICKET,
  basketball: BASKETBALL,
  pickleball: PICKLEBALL,
  tennis: TENNIS,
  badminton: BADMINTON,
  volleyball: VOLLEYBALL,
  multisport: MULTISPORT,
};

// Returns presets relevant to a selected sports set. For a single sport
// we show that sport's variants (basketball -> NBA + FIBA, etc.). For
// multi-sport selections we show ALL relevant presets so sales sees
// every option without losing the per-sport detail (e.g. selecting
// football + basketball keeps NBA/FIBA visible alongside the multi-
// sport plot sizes).
export function presetsForSports(sports: string[]): CourtPreset[] {
  if (sports.length === 0) return [];
  if (sports.length === 1) {
    return SPORT_STANDARDS[sports[0]] ?? [];
  }
  // Multi-sport: lead with multi-sport plot defaults, then append every
  // selected sport's standards. De-duped by label so the same preset
  // doesn't appear twice if two sports happen to share dimensions.
  const out: CourtPreset[] = [];
  const seen = new Set<string>();
  function add(list: CourtPreset[] | undefined) {
    if (!list) return;
    for (const p of list) {
      const k = `${p.label}|${p.lengthFt}x${p.widthFt}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
  }
  if (sports.includes("multisport")) add(SPORT_STANDARDS.multisport);
  for (const s of sports) {
    if (s === "multisport") continue;
    add(SPORT_STANDARDS[s]);
  }
  return out;
}
