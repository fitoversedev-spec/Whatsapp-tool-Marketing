// International standard court dimensions — sourced from the Fitoverse
// "Sports Court & Turf Dimensions — Master Reference" (governing bodies:
// FIVB, BWF, ITF, FIBA/NBA, USA Pickleball, FIFA/IFAB, MCC/ICC).
//
// Each sport ships a set of click-to-apply presets: the marked PLAYING AREA
// (governing-body standard) and the TOTAL footprint WITH RUN-OFF (playing
// area + safety buffer). The wizard's Step 1 renders these beneath the
// Length/Width inputs once a sport is picked, each chip showing its L × W in
// ft AND m plus the area — so sales never has to memorise a figure.
//
// Values in feet are rounded to the nearest whole foot for clean plot entry;
// the millimetre + hint fields carry the exact governing-body metric size.

export type CourtPreset = {
  label: string;
  lengthFt: number;
  widthFt: number;
  lengthMm: number;
  widthMm: number;
  areaSqFt: number;
  // Optional sub-variant tag (e.g. "NBA", "FIBA"). Lets the UI group chips.
  variant?: string;
  // One-line hint with the exact metric size / run-off note.
  hint?: string;
};

// 1. VOLLEYBALL — FIVB (18 × 9 m play; 3 m free zone min, 5/6.5 m for World).
const VOLLEYBALL: CourtPreset[] = [
  { label: "Playing area", lengthFt: 59, widthFt: 30, lengthMm: 18000, widthMm: 9000, areaSqFt: 1744, hint: "FIVB 18 × 9 m — marked court" },
  { label: "With run-off", lengthFt: 79, widthFt: 49, lengthMm: 24000, widthMm: 15000, areaSqFt: 3875, hint: "+3 m free zone all round (24 × 15 m)" },
  { label: "FIVB World / Olympic", lengthFt: 102, widthFt: 62, lengthMm: 31000, widthMm: 19000, areaSqFt: 6340, hint: "5 m sides / 6.5 m ends (31 × 19 m)" },
];

// 2. BADMINTON — BWF doubles (13.4 × 6.1 m play).
const BADMINTON: CourtPreset[] = [
  { label: "Playing area", lengthFt: 44, widthFt: 20, lengthMm: 13400, widthMm: 6100, areaSqFt: 880, hint: "BWF doubles 13.4 × 6.1 m — court" },
  { label: "With run-off (min)", lengthFt: 54, widthFt: 30, lengthMm: 16460, widthMm: 9140, areaSqFt: 1620, hint: "+1.5 m all sides (16.46 × 9.14 m)" },
  { label: "Recommended", lengthFt: 57, widthFt: 33, lengthMm: 17370, widthMm: 10050, areaSqFt: 1881, hint: "+2 m all sides (17.37 × 10.05 m)" },
];

// 3. TENNIS — ITF doubles (23.77 × 10.97 m play).
const TENNIS: CourtPreset[] = [
  { label: "Playing area", lengthFt: 78, widthFt: 36, lengthMm: 23770, widthMm: 10970, areaSqFt: 2808, hint: "ITF doubles 23.77 × 10.97 m — court" },
  { label: "With run-off", lengthFt: 120, widthFt: 60, lengthMm: 36580, widthMm: 18290, areaSqFt: 7200, hint: "ITF recommended (36.58 × 18.29 m)" },
];

// 4. BASKETBALL — FIBA (28 × 15 m), NBA (28.65 × 15.24 m), FIBA 3x3 (15 × 11 m).
const BASKETBALL: CourtPreset[] = [
  { label: "FIBA — play area", lengthFt: 92, widthFt: 49, lengthMm: 28000, widthMm: 15000, areaSqFt: 4520, hint: "28 × 15 m — marked court" },
  { label: "FIBA — full court", lengthFt: 105, widthFt: 62, lengthMm: 32000, widthMm: 19000, areaSqFt: 6544, hint: "+2 m run-off all sides (32 × 19 m)" },
  { label: "NBA — full court", lengthFt: 114, widthFt: 60, lengthMm: 34750, widthMm: 18290, areaSqFt: 6840, hint: "94 × 50 ft court + run-off" },
  { label: "3×3 half — play area", lengthFt: 49, widthFt: 36, lengthMm: 15000, widthMm: 11000, areaSqFt: 1776, hint: "FIBA 3x3 half court 15 × 11 m" },
  { label: "3×3 half — with run-off", lengthFt: 59, widthFt: 46, lengthMm: 18000, widthMm: 14000, areaSqFt: 2713, hint: "+1.5 m boundaries (18 × 14 m)" },
];

// 5. PICKLEBALL — USA Pickleball. One court size for every level (13.41 ×
// 6.10 m); only the run-off footprint scales up for competition.
const PICKLEBALL: CourtPreset[] = [
  { label: "Play area (all levels)", lengthFt: 44, widthFt: 20, lengthMm: 13410, widthMm: 6100, areaSqFt: 880, hint: "USAP 13.41 × 6.10 m — singles & doubles" },
  { label: "Recreational", lengthFt: 60, widthFt: 30, lengthMm: 18290, widthMm: 9140, areaSqFt: 1800, hint: "rec run-off (18.29 × 9.14 m)" },
  { label: "Tournament", lengthFt: 64, widthFt: 34, lengthMm: 19510, widthMm: 10360, areaSqFt: 2176, hint: "competition run-off (19.51 × 10.36 m)" },
];

// 6. CRICKET — MCC/ICC pitch (20.12 × 3.05 m) + standard build strips.
const CRICKET: CourtPreset[] = [
  { label: "Official pitch", lengthFt: 66, widthFt: 10, lengthMm: 20120, widthMm: 3050, areaSqFt: 661, hint: "MCC/ICC 20.12 × 3.05 m (22 yd)" },
  { label: "Turf strip — full", lengthFt: 66, widthFt: 7, lengthMm: 20000, widthMm: 2000, areaSqFt: 431, hint: "20 × 2 m build strip" },
  { label: "Turf strip — small", lengthFt: 33, widthFt: 7, lengthMm: 10000, widthMm: 2000, areaSqFt: 215, hint: "10 × 2 m build strip" },
];

// 7-11. FOOTBALL — FIFA/IFAB 11-a-side (105 × 68 m), FA 7-a-side (54.86 ×
// 36.58 m), FIFA futsal (40 × 20 m), FA outdoor turf 5-a-side (36.58 × 27.43 m).
const FOOTBALL: CourtPreset[] = [
  { label: "11-a-side (FIFA)", lengthFt: 345, widthFt: 223, lengthMm: 105000, widthMm: 68000, areaSqFt: 76853, hint: "105 × 68 m — play area" },
  { label: "11-a-side + run-off", lengthFt: 358, widthFt: 236, lengthMm: 109000, widthMm: 72000, areaSqFt: 84475, hint: "+2 m safety all sides (109 × 72 m)" },
  { label: "7-a-side (FA)", lengthFt: 180, widthFt: 120, lengthMm: 54860, widthMm: 36580, areaSqFt: 21600, hint: "54.86 × 36.58 m — play area" },
  { label: "Futsal / 5-a-side", lengthFt: 131, widthFt: 66, lengthMm: 40000, widthMm: 20000, areaSqFt: 8611, hint: "FIFA 40 × 20 m hard court" },
  { label: "5-a-side turf (FA)", lengthFt: 120, widthFt: 90, lengthMm: 36580, widthMm: 27430, areaSqFt: 10800, hint: "36.58 × 27.43 m artificial grass" },
];

// 12. MULTISPORT / CUSTOM TURF — flexible builds (5,000–20,000 sq ft).
// Illustrative rectangles from the reference; pick L × W to suit the plot.
const MULTISPORT: CourtPreset[] = [
  { label: "5,000 sq ft", lengthFt: 98, widthFt: 51, lengthMm: 30000, widthMm: 15500, areaSqFt: 5000, hint: "custom turf 30 × 15.5 m" },
  { label: "10,000 sq ft", lengthFt: 131, widthFt: 76, lengthMm: 40000, widthMm: 23200, areaSqFt: 10000, hint: "custom turf 40 × 23.2 m" },
  { label: "15,000 sq ft", lengthFt: 164, widthFt: 92, lengthMm: 50000, widthMm: 27900, areaSqFt: 15000, hint: "custom turf 50 × 27.9 m" },
  { label: "20,000 sq ft", lengthFt: 197, widthFt: 102, lengthMm: 60000, widthMm: 31000, areaSqFt: 20000, hint: "custom turf 60 × 31 m" },
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

// Returns presets relevant to a selected sports set. For a single sport we
// show that sport's variants; for multi-sport we lead with the custom/
// multisport plot sizes then append every selected sport's presets, de-duped
// by label so nothing appears twice.
export function presetsForSports(sports: string[]): CourtPreset[] {
  if (sports.length === 0) return [];
  if (sports.length === 1) {
    return SPORT_STANDARDS[sports[0]] ?? [];
  }
  const out: CourtPreset[] = [];
  const seen = new Set<string>();
  // Prefix each preset with its sport so a mixed selection doesn't show two
  // ambiguous "Playing area" chips.
  function add(list: CourtPreset[] | undefined, prefix?: string) {
    if (!list) return;
    for (const p of list) {
      const k = `${p.label}|${p.lengthFt}x${p.widthFt}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(prefix ? { ...p, label: `${prefix} · ${p.label}` } : p);
    }
  }
  if (sports.includes("multisport")) add(SPORT_STANDARDS.multisport);
  for (const s of sports) {
    if (s === "multisport") continue;
    add(SPORT_STANDARDS[s], s.charAt(0).toUpperCase() + s.slice(1));
  }
  return out;
}
