// Display units for quotation line items. These seed the UNIT column and back
// the unit drop-down (with free manual entry) across the rate-sheet editor,
// the standalone quote wizard, and the court-designer quote step.
//
// The list is a set of SUGGESTIONS surfaced via an <input list={...}> datalist,
// so sales can pick one OR type any custom unit (LS, set, m, kg, …).

export const UNIT_OPTIONS = ["sq.ft", "rft", "qty"] as const;

// Shared datalist id so every unit input across the app offers the same
// suggestions.
export const UNIT_DATALIST_ID = "quote-unit-options";

// Default display unit for a rate-sheet area mode, used when an item carries no
// explicit unit. Perimeter rows are running-feet (rft), per-piece rows are a
// count (qty), everything else is area (sq.ft).
export function defaultUnitForAreaMode(areaMode: string): string {
  return areaMode === "per_piece"
    ? "qty"
    : areaMode === "perimeter"
      ? "rft"
      : "sq.ft";
}
