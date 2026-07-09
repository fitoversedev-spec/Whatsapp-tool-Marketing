// Box-build parameters (India practice) — from the Cricket + Football
// Time-Shared Turf Spec, Part C. Cost/spec for the enclosed "box": nets,
// poles, clearance, turf pile, orientation and lighting.
//
// Key rule reused across the tool: cost scales by PERIMETER (poles + side
// net), not area — so curved shapes (more perimeter per sq ft) cost more.

export const BOX_BUILD = {
  // Outdoor cricket net heights (ft).
  netHeight: { overarmMin: 30, overarmMax: 40, tennisBallMin: 20, tennisBallMax: 25, default: 35 },
  poleAboveNetFt: 2.5, // build poles ~2–3 ft above the net (roof-net sag buffer)
  poleSpacingFt: 10, // GI poles ~ every 10 ft around the perimeter
  clearanceFt: { min: 3, max: 5 }, // boundary → net (player safety / access)
  turfPileMm: { multisport: 15, cricketStrip: { min: 9, max: 12 } },
  orientation: "north–south long axis", // avoids low-sun glare
  lightWatts: 200, // perimeter LED floods, spaced with the poles
  poleSpec: '3–4 in GI (B/C class) or 4×4 in square, 14 gauge',
  sideNetSpec: "2.5 mm braided HDPE/nylon",
  roofNetSpec: "1–1.5 mm twisted",
} as const;

export type BoxBuildEstimate = {
  perimeterFt: number;
  netHeightFt: number;
  poleHeightFt: number;
  poles: number;
  sideNetSqFt: number;
  roofNetSqFt: number;
  lights: number;
  clearanceFt: number;
};

// Estimate the box-build bill of quantities from the plot perimeter + area.
// `roofed` adds the roof/top net over the whole footprint (box cricket).
export function estimateBoxBuild(
  perimeterFt: number,
  plotAreaSqFt: number,
  opts: { netHeightFt?: number; roofed?: boolean; clearanceFt?: number } = {},
): BoxBuildEstimate {
  const netHeightFt = opts.netHeightFt ?? BOX_BUILD.netHeight.default;
  const poleHeightFt = netHeightFt + BOX_BUILD.poleAboveNetFt;
  const poles = Math.max(4, Math.ceil(perimeterFt / BOX_BUILD.poleSpacingFt));
  return {
    perimeterFt,
    netHeightFt,
    poleHeightFt,
    poles,
    sideNetSqFt: Math.round(perimeterFt * netHeightFt),
    roofNetSqFt: opts.roofed ? Math.round(plotAreaSqFt) : 0,
    lights: poles, // one flood per pole
    clearanceFt: opts.clearanceFt ?? BOX_BUILD.clearanceFt.min,
  };
}
