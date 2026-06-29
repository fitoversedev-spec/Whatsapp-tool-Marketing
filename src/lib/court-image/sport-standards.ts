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
const VOLLEYBALL: CourtPreset[] = [
  {
    label: "Play Area (Doubles)",
    lengthFt: 59,
    widthFt: 29.6,
    lengthMm: 18000,
    widthMm: 9000,
    areaSqFt: 1743,
    hint: "Court only",
  },
  {
    label: "With Run-Off",
    lengthFt: 82,
    widthFt: 42.6,
    lengthMm: 25000,
    widthMm: 12980,
    areaSqFt: 3493,
    hint: "Recommended for clubs / tournaments",
  },
  {
    label: "Minimum Recommended",
    lengthFt: 70,
    widthFt: 36,
    lengthMm: 21340,
    widthMm: 10970,
    areaSqFt: 2520,
    hint: "10' length + 6' width margin",
  },
];

// Badminton
const BADMINTON: CourtPreset[] = [
  {
    label: "Play Area (Doubles)",
    lengthFt: 44,
    widthFt: 20,
    lengthMm: 13410,
    widthMm: 6100,
    areaSqFt: 880,
    hint: "Court only",
  },
  {
    label: "With Run-Off",
    lengthFt: 57,
    widthFt: 33,
    lengthMm: 17370,
    widthMm: 10000,
    areaSqFt: 1881,
    hint: "Tournament-grade",
  },
  {
    label: "Minimum Recommended",
    lengthFt: 54,
    widthFt: 30,
    lengthMm: 16460,
    widthMm: 9140,
    areaSqFt: 1620,
  },
];

// Tennis
const TENNIS: CourtPreset[] = [
  {
    label: "Play Area (Doubles)",
    lengthFt: 78,
    widthFt: 36,
    lengthMm: 23780,
    widthMm: 10975,
    areaSqFt: 2808,
    hint: "Court only",
  },
  {
    label: "With Run-Off",
    lengthFt: 120,
    widthFt: 60,
    lengthMm: 36580,
    widthMm: 18290,
    areaSqFt: 7200,
    hint: "Tournament with full clearance",
  },
];

// Basketball — NBA + FIBA variants
const BASKETBALL: CourtPreset[] = [
  {
    label: "NBA Play Area",
    variant: "NBA",
    lengthFt: 94,
    widthFt: 50,
    lengthMm: 28650,
    widthMm: 15240,
    areaSqFt: 4700,
    hint: "Pro standard",
  },
  {
    label: "NBA With Run-Off",
    variant: "NBA",
    lengthFt: 114,
    widthFt: 60,
    lengthMm: 34750,
    widthMm: 18290,
    areaSqFt: 6840,
    hint: "Tournament-grade",
  },
  {
    label: "NBA Minimum Recommended",
    variant: "NBA",
    lengthFt: 100,
    widthFt: 56,
    lengthMm: 30480,
    widthMm: 17000,
    areaSqFt: 5600,
    hint: "6' L / 8' W margin",
  },
  {
    label: "FIBA Play Area",
    variant: "FIBA",
    lengthFt: 91.84,
    widthFt: 49.2,
    lengthMm: 28000,
    widthMm: 15000,
    areaSqFt: 4520,
    hint: "International standard",
  },
  {
    label: "FIBA With Run-Off",
    variant: "FIBA",
    lengthFt: 104.9,
    widthFt: 62.3,
    lengthMm: 32000,
    widthMm: 19000,
    areaSqFt: 6544,
  },
  {
    label: "FIBA Minimum Recommended",
    variant: "FIBA",
    lengthFt: 98.4,
    widthFt: 55.76,
    lengthMm: 30000,
    widthMm: 17000,
    areaSqFt: 5489,
    hint: "6.56' / 6.56' margin",
  },
];

// Football — common Indian-market builds, not on the Ebaco chart.
// Kept here for parity so the wizard chip strip works for every sport.
const FOOTBALL: CourtPreset[] = [
  {
    label: "5-a-side (compact)",
    lengthFt: 100,
    widthFt: 60,
    lengthMm: 30480,
    widthMm: 18290,
    areaSqFt: 6000,
    hint: "Box turf / fitness",
  },
  {
    label: "5-a-side (standard)",
    lengthFt: 130,
    widthFt: 65,
    lengthMm: 39620,
    widthMm: 19810,
    areaSqFt: 8450,
  },
  {
    label: "7-a-side",
    lengthFt: 200,
    widthFt: 130,
    lengthMm: 60960,
    widthMm: 39620,
    areaSqFt: 26000,
    hint: "Commercial rental",
  },
  {
    label: "11-a-side (FIFA)",
    lengthFt: 344,
    widthFt: 223,
    lengthMm: 104852,
    widthMm: 67970,
    areaSqFt: 76712,
    hint: "Tournament grade",
  },
];

// Pickleball — USAPA singles + doubles + tournament
const PICKLEBALL: CourtPreset[] = [
  {
    label: "Singles / Doubles",
    lengthFt: 44,
    widthFt: 20,
    lengthMm: 13410,
    widthMm: 6100,
    areaSqFt: 880,
    hint: "Court only",
  },
  {
    label: "With Buffer",
    lengthFt: 60,
    widthFt: 30,
    lengthMm: 18290,
    widthMm: 9144,
    areaSqFt: 1800,
    hint: "Recommended",
  },
  {
    label: "Tournament",
    lengthFt: 64,
    widthFt: 34,
    lengthMm: 19510,
    widthMm: 10360,
    areaSqFt: 2176,
    hint: "Full run-off",
  },
];

// Cricket — pitch + boundary radius variants
const CRICKET: CourtPreset[] = [
  {
    label: "Box cricket",
    lengthFt: 80,
    widthFt: 50,
    lengthMm: 24380,
    widthMm: 15240,
    areaSqFt: 4000,
    hint: "12 yd pitch enclosed",
  },
  {
    label: "Junior ground",
    lengthFt: 180,
    widthFt: 180,
    lengthMm: 54860,
    widthMm: 54860,
    areaSqFt: 32400,
    hint: "22 yd pitch + 60m boundary",
  },
  {
    label: "Club ground",
    lengthFt: 240,
    widthFt: 240,
    lengthMm: 73150,
    widthMm: 73150,
    areaSqFt: 57600,
    hint: "22 yd pitch + 75m boundary",
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
