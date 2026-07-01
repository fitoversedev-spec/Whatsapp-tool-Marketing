// Dimension unit primitives — pure conversion + display helpers.
// Canonical storage is FEET everywhere in the database + JSON schemas.
// Everything user-visible flows through here so the same value renders
// differently based on the viewer's preferredUnit.
//
// Conversion factor: 1 foot = 0.3048 metres exactly (international foot).

export type Unit = "ft" | "m";

export const FT_TO_M = 0.3048;
export const M_TO_FT = 1 / FT_TO_M;

// SqFt <-> m² share the same factor squared.
export const SQFT_TO_SQM = FT_TO_M * FT_TO_M;
export const SQM_TO_SQFT = 1 / SQFT_TO_SQM;

// Linear dimension: feet in → user's unit out (as number).
export function toUnit(feet: number, unit: Unit): number {
  return unit === "ft" ? feet : feet * FT_TO_M;
}

// Linear dimension: user's unit → feet (canonical).
export function toFeet(value: number, unit: Unit): number {
  return unit === "ft" ? value : value * M_TO_FT;
}

// Area: sqft in → user's unit-squared out.
export function areaToUnit(sqft: number, unit: Unit): number {
  return unit === "ft" ? sqft : sqft * SQFT_TO_SQM;
}

// Area: user's unit-squared → sqft (canonical).
export function areaToSqFt(value: number, unit: Unit): number {
  return unit === "ft" ? value : value * SQM_TO_SQFT;
}

// Formatted "80 ft" or "24 m" (rounded to whole numbers by default).
// Callers pass the CANONICAL feet value; the helper renders per unit.
export function formatLength(
  feetValue: number,
  unit: Unit,
  opts?: { decimals?: number }
): string {
  const decimals = opts?.decimals ?? 1;
  const v = toUnit(feetValue, unit);
  const rounded =
    unit === "ft"
      ? Math.round(v)
      : Number(v.toFixed(decimals));
  return `${rounded} ${unit}`;
}

// "80 × 60 ft" or "24.4 × 18.3 m"
export function formatDimensions(
  lengthFt: number,
  widthFt: number,
  unit: Unit
): string {
  return `${formatLength(lengthFt, unit)} × ${formatLength(widthFt, unit)}`.replace(
    ` ${unit} ×`,
    " ×"
  );
}

// "6,000 sqft" or "557 m²"
export function formatArea(
  sqftValue: number,
  unit: Unit,
  opts?: { decimals?: number }
): string {
  const decimals = opts?.decimals ?? 0;
  const v = areaToUnit(sqftValue, unit);
  const rounded =
    unit === "ft" ? Math.round(v) : Number(v.toFixed(decimals));
  const suffix = unit === "ft" ? "sqft" : "m²";
  return `${rounded.toLocaleString("en-IN")} ${suffix}`;
}

// DUAL-UNIT display — always shows both units. Used in exported PDFs
// (Option C) so customers never have to convert.
//   feet -> "80 ft (24.4 m)"
export function formatLengthDual(feetValue: number): string {
  const m = feetValue * FT_TO_M;
  return `${Math.round(feetValue)} ft (${m.toFixed(1)} m)`;
}

//   feet x feet -> "80 × 60 ft (24.4 × 18.3 m)"
export function formatDimensionsDual(
  lengthFt: number,
  widthFt: number
): string {
  const lm = lengthFt * FT_TO_M;
  const wm = widthFt * FT_TO_M;
  return `${Math.round(lengthFt)} × ${Math.round(widthFt)} ft (${lm.toFixed(1)} × ${wm.toFixed(1)} m)`;
}

//   sqft -> "6,000 sqft (557 m²)"
export function formatAreaDual(sqftValue: number): string {
  const sqm = sqftValue * SQFT_TO_SQM;
  return `${Math.round(sqftValue).toLocaleString("en-IN")} sqft (${Math.round(sqm).toLocaleString("en-IN")} m²)`;
}
