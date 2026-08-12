// Court layout schema — single source of truth shared by the 2D Konva
// editor, the server-side persistence layer, and (future) the 3D Three.js
// renderer. The wizard mutates a CourtLayout in memory; on save we JSON-
// stringify it into the CourtImage.layout column.
//
// All measurements are in feet (ft). Positions are in plot-space:
//   x = horizontal from plot's bottom-left (0 = left edge, plot.length = right edge)
//   y = vertical from plot's bottom-left (0 = bottom edge, plot.width = top edge)
// Rotations are degrees, clockwise.
//
// Adding a new element type? Add it to the Element union, default style in
// DEFAULT_STYLE, and a renderer branch in CourtCanvas + the (future) 3D
// scene builder.

import { polygonAreaSqFt } from "./turf-shapes";
import { predictCapacity } from "./packing";
import { SPORT_DIMS, FOOTBALL_PLAY_SIZES } from "./sport-dims";

export type Sport =
  | "football"
  | "cricket"
  | "basketball"
  | "pickleball"
  | "tennis"
  | "badminton"
  | "volleyball"
  | "multisport";

export const SPORT_LABEL: Record<Sport, string> = {
  football: "Football",
  cricket: "Cricket",
  basketball: "Basketball",
  pickleball: "Pickleball",
  tennis: "Tennis",
  badminton: "Badminton",
  volleyball: "Volleyball",
  multisport: "Multisport",
};

export type Plot = {
  // Plot dimensions in ft. length = horizontal, width = vertical.
  lengthFt: number;
  widthFt: number;
  // Optional polygon boundary (non-standard mode). When set, the plot
  // renders as this closed polygon instead of a rectangle. Coordinates
  // are in plot space (feet), origin at bottom-left of the bounding
  // box, going anticlockwise. lengthFt × widthFt still describes the
  // bounding rectangle so scaling + dimension labels keep working.
  polygon?: Array<{ x: number; y: number }>;
  // P6-02 — optional obstacle the turf boundary curves around (e.g. the
  // kidney-shape tree/pole). When set, both renderers draw a marker at this
  // plot-space point so the customer sees what the layout avoids. Absent on
  // every existing layout, so nothing already saved changes.
  obstacle?: { x: number; y: number; radiusFt?: number; kind?: "tree" | "pole" };
  // P6-03 — vertical profile. All optional; all default to today's flat
  // render. surfaceThicknessMm = playing-surface build-up (turf pile / slab)
  // shown as a real lip in 3D; baseElevationFt raises the whole court above
  // grade; curb draws a raised kerb frame around the plot edge. 3D-only.
  surfaceThicknessMm?: number;
  baseElevationFt?: number;
  curb?: boolean;
  curbColor?: string;
};

// Preset plot shape helpers — produce a polygon relative to a given
// lengthFt × widthFt rectangle. All shapes stay INSIDE the bounding
// rectangle so the existing scale + dimension labels don't need
// special-case handling.
export type PlotShape =
  | { kind: "rect" }
  | { kind: "cut-corner"; corner: "tl" | "tr" | "bl" | "br"; sizePct: number }
  | { kind: "diagonal"; edge: "top" | "bottom"; slopePct: number }
  | { kind: "l-shape"; corner: "tl" | "tr" | "bl" | "br"; wPct: number; hPct: number };

// Build a polygon composed of multiple corner cuts. Cuts stack: sales
// can click "Cut top-left" AND "Cut bottom-right" to get both notches.
// sizePct defaults to 25 % — sensible for most trim requests.
export function buildMultiCutPolygon(
  lengthFt: number,
  widthFt: number,
  cuts: {
    tl?: boolean;
    tr?: boolean;
    bl?: boolean;
    br?: boolean;
    sizePct?: number;
  }
): Array<{ x: number; y: number }> | undefined {
  const anyCut = cuts.tl || cuts.tr || cuts.bl || cuts.br;
  if (!anyCut) return undefined;
  const L = lengthFt;
  const W = widthFt;
  const pct = (cuts.sizePct ?? 25) / 100;
  const cx = pct * L;
  const cy = pct * W;
  const poly: Array<{ x: number; y: number }> = [];
  // Traverse anticlockwise from the bottom-left corner, splitting
  // each corner vertex into two if it's cut.
  if (cuts.bl) {
    poly.push({ x: cx, y: 0 });
  } else {
    poly.push({ x: 0, y: 0 });
  }
  if (cuts.br) {
    poly.push({ x: L - cx, y: 0 });
    poly.push({ x: L, y: cy });
  } else {
    poly.push({ x: L, y: 0 });
  }
  if (cuts.tr) {
    poly.push({ x: L, y: W - cy });
    poly.push({ x: L - cx, y: W });
  } else {
    poly.push({ x: L, y: W });
  }
  if (cuts.tl) {
    poly.push({ x: cx, y: W });
    poly.push({ x: 0, y: W - cy });
  } else {
    poly.push({ x: 0, y: W });
  }
  if (cuts.bl) {
    poly.push({ x: 0, y: cy });
  }
  return poly;
}

export function buildPlotPolygon(
  lengthFt: number,
  widthFt: number,
  shape: PlotShape
): Array<{ x: number; y: number }> | undefined {
  const L = lengthFt;
  const W = widthFt;
  if (shape.kind === "rect") return undefined;
  if (shape.kind === "cut-corner") {
    const cx = (shape.sizePct / 100) * L;
    const cy = (shape.sizePct / 100) * W;
    switch (shape.corner) {
      case "bl":
        return [
          { x: cx, y: 0 },
          { x: L, y: 0 },
          { x: L, y: W },
          { x: 0, y: W },
          { x: 0, y: cy },
        ];
      case "br":
        return [
          { x: 0, y: 0 },
          { x: L - cx, y: 0 },
          { x: L, y: cy },
          { x: L, y: W },
          { x: 0, y: W },
        ];
      case "tr":
        return [
          { x: 0, y: 0 },
          { x: L, y: 0 },
          { x: L, y: W - cy },
          { x: L - cx, y: W },
          { x: 0, y: W },
        ];
      case "tl":
        return [
          { x: 0, y: 0 },
          { x: L, y: 0 },
          { x: L, y: W },
          { x: cx, y: W },
          { x: 0, y: W - cy },
        ];
    }
  }
  if (shape.kind === "diagonal") {
    const dx = (shape.slopePct / 100) * L;
    if (shape.edge === "top") {
      return [
        { x: 0, y: 0 },
        { x: L, y: 0 },
        { x: L - dx, y: W },
        { x: dx, y: W },
      ];
    } else {
      return [
        { x: dx, y: 0 },
        { x: L - dx, y: 0 },
        { x: L, y: W },
        { x: 0, y: W },
      ];
    }
  }
  if (shape.kind === "l-shape") {
    const nx = (shape.wPct / 100) * L;
    const ny = (shape.hPct / 100) * W;
    switch (shape.corner) {
      case "bl":
        return [
          { x: nx, y: 0 },
          { x: L, y: 0 },
          { x: L, y: W },
          { x: 0, y: W },
          { x: 0, y: ny },
          { x: nx, y: ny },
        ];
      case "br":
        return [
          { x: 0, y: 0 },
          { x: L - nx, y: 0 },
          { x: L - nx, y: ny },
          { x: L, y: ny },
          { x: L, y: W },
          { x: 0, y: W },
        ];
      case "tr":
        return [
          { x: 0, y: 0 },
          { x: L, y: 0 },
          { x: L, y: W - ny },
          { x: L - nx, y: W - ny },
          { x: L - nx, y: W },
          { x: 0, y: W },
        ];
      case "tl":
        return [
          { x: 0, y: 0 },
          { x: L, y: 0 },
          { x: L, y: W },
          { x: nx, y: W },
          { x: nx, y: W - ny },
          { x: 0, y: W - ny },
        ];
    }
  }
  return undefined;
}

// P4-01 — Optional physically-based material description for an element or the
// plot surface. EVERY field is optional: when `material` is absent (all saved
// layouts today) the renderers fall back to their existing flat-hex / stripe
// behaviour, so nothing already saved changes. This is the shared substrate the
// 3D pipeline (Phase 3) and the material registry (P4-02) map onto; renderer
// adoption is incremental and never required for a layout to draw.
//   baseColorHex — albedo when no map is set (overrides the flat fill).
//   roughness/metalness/opacity/sheen/clearcoat/emissive — MeshStandard /
//     MeshPhysical parameters (0..1 except emissive = hex).
//   albedoMap/normalMap/roughnessMap/aoMap — texture URLs (served from /public).
//   tiling — real-world repeat so a map reads at true scale.
export type MaterialSpec = {
  baseColorHex?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  sheen?: number;
  clearcoat?: number;
  emissive?: string;
  albedoMap?: string;
  normalMap?: string;
  roughnessMap?: string;
  aoMap?: string;
  tiling?: { repeatMeters?: number; rotationDeg?: number };
};

// Discriminated union — `type` drives renderer behavior.
// Common fields (x, y, rotation, locked) live on every element via the
// CommonElementFields base type below.
type CommonElementFields = {
  id: string;
  // Plot-space position of the element's centroid.
  x: number;
  y: number;
  rotation: number; // degrees, clockwise
  // When true, the element ignores drag/resize handles in the editor.
  locked?: boolean;
  // When false, the element is hidden from the canvas + rendered output.
  visible?: boolean;
  // Stack order — higher renders on top. Defaults assigned by the layout
  // builder so cricket pitch ends up above football lines.
  z?: number;
  // P4-01: optional per-element PBR material override. Absent on every saved
  // layout; renderers ignore it unless present, so existing designs are
  // byte-identical. Lets a future editor tune a single element's finish
  // (e.g. a glossy acrylic key) without a new element type.
  material?: MaterialSpec;
};

// Football field — outer rect, halfway line, center circle, two penalty
// boxes, two goal boxes, four corner arcs, two penalty spots and arcs.
// All sub-markings derive from width/height/aSide so the customer can drag
// a corner to resize and the markings rescale automatically.
export type FootballFieldElement = CommonElementFields & {
  type: "football-field";
  width: number; // along x axis, in ft
  height: number; // along y axis, in ft
  // Optional sub-config: which a-side preset to use for marking proportions.
  // Affects penalty box / goal area scale relative to width/height.
  aSide: 5 | 7 | 11;
  // Style overrides (color of grass + line; default from style)
  grassColor?: string;
  lineColor?: string;
};

// Cricket pitch — 22-yard rectangular surface with stumps + crease markings
// at each end. Length is configurable (22 yd regulation, 12 yd compact, or
// custom) to support the half-pitch setups common on smaller turfs.
export type CricketPitchElement = CommonElementFields & {
  type: "cricket-pitch";
  // Pitch length in feet (22 yd = 66 ft, 12 yd = 36 ft).
  pitchLengthFt: number;
  pitchWidthFt: number;
  pitchColor?: string;
  markingColor?: string;
};

// Basketball court — half-court or full-court, with key, free-throw circle,
// 3-point arc. width = sideline-to-sideline.
export type BasketballCourtElement = CommonElementFields & {
  type: "basketball-court";
  width: number;
  height: number;
  halfCourt: boolean;
  surfaceColor?: string;
  lineColor?: string;
};

// Pickleball court — kitchen / non-volley zone + service courts + baselines.
export type PickleballCourtElement = CommonElementFields & {
  type: "pickleball-court";
  width: number;
  height: number;
  surfaceColor?: string;
  lineColor?: string;
};

// Generic court rectangle for sports we don't have detailed markings for
// yet (tennis / badminton / volleyball). Falls back to a labeled rect with
// center line. Adds future-proofing without forcing per-sport renderers.
export type GenericCourtElement = CommonElementFields & {
  type: "generic-court";
  sport: Sport;
  width: number;
  height: number;
  surfaceColor?: string;
  lineColor?: string;
};

// Standalone goal post pair. Used when the user adds extras (e.g. mini
// goals for futsal). Football fields auto-render their own goals from the
// field element so they don't double up.
export type GoalPostElement = CommonElementFields & {
  type: "goal-post";
  widthFt: number;
  heightFt: number;
  depthFt: number;
  color?: string;
};

// Net post pair — for badminton / volleyball / tennis when the customer
// wants a generic court without the full marking renderer.
export type NetElement = CommonElementFields & {
  type: "net";
  widthFt: number;
  heightFt: number;
  color?: string;
};

// Free-text label placed anywhere on the court (customer name, court
// number, instructions). Sales can pick size, color, and rotation.
export type AnnotationElement = CommonElementFields & {
  type: "annotation";
  text: string;
  fontSize: number; // in ft (renderer scales to canvas px)
  color?: string;
  background?: string; // optional pill bg
  align?: "left" | "center" | "right";
};

// Custom user-drawn line — for marking arrows, divider lines, dimension
// callouts, etc. Stored as start + end points relative to element center.
export type CustomLineElement = CommonElementFields & {
  type: "custom-line";
  lengthFt: number;
  thickness: number; // px in canvas (independent of plot scale)
  color?: string;
  arrow?: "none" | "end" | "both";
  dashed?: boolean;
};

// Decorative rectangle — used for fencing outlines, dugouts, mini areas.
export type CustomRectElement = CommonElementFields & {
  type: "custom-rect";
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
};

// Coloured zone overlay used to highlight specific parts of a court —
// basketball key / paint area, tennis service box, badminton service
// courts, volleyball attack zones, pickleball kitchen, etc. Sits UNDER
// the sport markings (low z-index) so lines still read on top. Sales
// draws a rectangle anywhere on the canvas and picks a colour; the
// zone becomes a filled rectangle at that location. Not for football
// or cricket per the user's ask.
export type HighlightZoneElement = CommonElementFields & {
  type: "highlight-zone";
  width: number;
  height: number;
  // Hex or rgba() colour. Semi-transparent by default so markings
  // above it (drawn later in element order) stay legible.
  fill: string;
  // Optional preset tag — "basketball-key", "tennis-service-box",
  // etc. — for future preset shortcuts. Free-drawn zones leave this
  // undefined.
  preset?: string;
  // Shape of the zone. "rect" (default) = plain rectangle centred on
  // the element origin. "arc-right" = semi-circle pie slice with
  // diameter along Y and arc extending +X. "arc-left" = mirror.
  // "ring" = the rectangle MINUS an inner cutout (holeW/holeH at
  // holeCx/holeCy) — used to highlight the run-off area around a
  // court without covering the court itself.
  shape?: "rect" | "arc-right" | "arc-left" | "ring";
  // Inner cutout for shape="ring", in the zone's LOCAL feet (offset
  // from the zone centre). Captured from the primary court's bounds at
  // creation time.
  holeCx?: number;
  holeCy?: number;
  holeW?: number;
  holeH?: number;
  // Multiple cutouts (one per court) for a multi-court run-off ring — every
  // court is punched out of the tint so only the run-off around each shows.
  // In the zone's LOCAL feet (offset from the zone centre).
  holes?: Array<{ cx: number; cy: number; w: number; h: number }>;
};

// Chain-link / mesh fence drawn as a rectangle outline. In 2D the rect
// shows with a hatched mesh fill; in 3D it becomes a translucent vertical
// mesh wall around the perimeter at `heightFt` height.
export type FenceRectElement = CommonElementFields & {
  type: "fence-rect";
  width: number;
  height: number;
  heightFt: number;
  color?: string;
  hasGate?: boolean;
  // Which edge the gate sits on. Compass names so the 2D and 3D
  // renderers share one orientation system. The renderer leaves a gap
  // in the mesh at the centre of that edge — reads as an entrance.
  gateEdge?: "north" | "south" | "east" | "west";
};

// Player dugout / bench shelter. Sized for ~10ft × 6ft by default. 2D
// shows a small rect with the bench facing the field. 3D is a low box +
// slanted roof.
export type DugoutElement = CommonElementFields & {
  type: "dugout";
  width: number;
  height: number;
  // Direction the open side faces. "north" means the opening points to
  // +Y in plot-space (towards the top of the canvas).
  openSide: "north" | "south" | "east" | "west";
  roofColor?: string;
  benchColor?: string;
};

// Standalone basketball hoop — pole + arm + backboard + rim. Placed
// independently of the basketball court so the user can stack one on a
// driveway, place two flanking a futsal pitch, etc.
export type BasketballHoopElement = CommonElementFields & {
  type: "basketball-hoop";
  // The rim sits on this side of the pole; rotation handles re-orientation
  // but the model is asymmetric so we keep the natural side baked in.
  poleHeightFt: number;
  backboardWidthFt: number;
  color?: string;
  rimColor?: string;
};

// ─────────────────────────────────────────────────────────────────────
//  P6 — Facility depth: floodlights + site objects
//  Every field below is OPTIONAL-friendly (sensible defaults in the
//  factories + renderers) so a bare {type,x,y,rotation,id} still draws,
//  and — critically — NO existing saved layout carries any of these types,
//  so nothing already stored changes. New types render in BOTH 2D (icon)
//  and 3D (geometry).
// ─────────────────────────────────────────────────────────────────────

// P6-01 — Floodlight mast. A stadium-style lighting pole with one or more
// lamp heads on a crossbar. In 3D it becomes a mast + emissive lamp array +
// a downward SpotLight, so with style.timeOfDay = "evening"/"night" the
// customer previews a floodlit scene. In 2D it's a top-down icon: pole dot,
// head bar, and a soft light cone pointing along the mast's aim.
export type FloodlightElement = CommonElementFields & {
  type: "floodlight";
  poleHeightFt: number; // mast height
  heads: number; // lamp heads on the crossbar
  lumens?: number; // total output (informational, surfaced in callouts)
  colorTempK?: number; // lamp colour temperature (2700 warm … 6500 cool)
  // Distance (ft) the beam reaches forward (toward the mast's local +Y /
  // "north" before rotation) as it lands on the surface. Seeded from the
  // plot size in the factory; a renderer default covers an absent value.
  aimReachFt?: number;
};

// P6-02 — Spectator seating / tiered bleacher. width runs along the front
// of the stand; depth is how far back the tiers go; rows = number of steps.
export type SeatingElement = CommonElementFields & {
  type: "seating";
  width: number; // along local x (seat rows run this way)
  depth: number; // along local y (stand depth, back-to-front)
  rows?: number; // tiered rows (default 4)
  color?: string; // seat colour
};

// Scoreboard / display board raised on two posts.
export type ScoreboardElement = CommonElementFields & {
  type: "scoreboard";
  widthFt: number;
  heightFt: number; // panel top height above ground
  color?: string; // frame colour
};

// Cricket sight-screen — the large pale board behind the bowler's arm.
export type SightScreenElement = CommonElementFields & {
  type: "sight-screen";
  widthFt: number;
  heightFt: number;
  color?: string; // board colour (near-white default)
};

// Corner flag (football) — short pole with a small triangular flag.
export type CornerFlagElement = CommonElementFields & {
  type: "corner-flag";
  heightFt?: number;
  color?: string; // flag colour
};

// Pedestrian gate / entrance — two posts + a swing leaf.
export type GateElement = CommonElementFields & {
  type: "gate";
  widthFt: number;
  heightFt: number;
  color?: string;
};

// Centre-court logo / crest — a flat decal disc laid on the playing surface.
// imageUrl is the logo bitmap; when absent it falls back to a text/initial ring.
export type CenterLogoElement = CommonElementFields & {
  type: "center-logo";
  diameterFt: number;
  imageUrl?: string;
  text?: string;
  color?: string; // ring / text colour
};

export type Element =
  | FootballFieldElement
  | CricketPitchElement
  | BasketballCourtElement
  | PickleballCourtElement
  | GenericCourtElement
  | GoalPostElement
  | NetElement
  | AnnotationElement
  | CustomLineElement
  | CustomRectElement
  | FenceRectElement
  | DugoutElement
  | BasketballHoopElement
  | HighlightZoneElement
  | FloodlightElement
  | SeatingElement
  | ScoreboardElement
  | SightScreenElement
  | CornerFlagElement
  | GateElement
  | CenterLogoElement;

// Surface finishes used inside the plot footprint.
//   plain          — earth-coloured base (undecided material)
//   ppe_tile_*     — interlocking PPE tiles laid on prepared sub-base.
//                    Fitoverse sells these by the piece (30 × 30 cm
//                    each), so the wizard shows a live tile-count pill.
//   acrylic_*      — hard-court acrylic coating over a concrete slab.
//                    Sold by the sqft, no tile count — just a solid
//                    colour fill matching the coating.
export type SurfaceFinish =
  | "plain"
  | "ppe_tile_red"
  | "acrylic_blue"
  | "acrylic_green"
  | "turf_40mm"
  | "turf_50mm"
  | "pvc_sports";

export const SURFACE_LABEL: Record<SurfaceFinish, string> = {
  plain: "Plain earth",
  ppe_tile_red: "PPE tile — red",
  acrylic_blue: "Acrylic — blue",
  acrylic_green: "Acrylic — green",
  turf_40mm: "Artificial grass — 40 mm",
  turf_50mm: "Artificial grass — 50 mm",
  pvc_sports: "PVC sports flooring",
};

// P4-02 — FINISH_MATERIAL registry: ONE record per surface finish that carries
// everything the 2D and 3D renderers need, replacing the four parallel maps
// (SURFACE_IMAGE_URL / TURF_IMAGE_URLS / SURFACE_SOLID_COLOR / TURF_STRIPE_COLORS
// / SURFACE_TILE_METERS) that had to be kept in sync by hand. Those maps are now
// DERIVED from this registry (below) so every consumer keeps working unchanged
// and the values stay byte-identical (verified by the P4 regression script).
//
// Fields split into two groups:
//   * 2D / callout data — solidColor, imageUrl, turfImages, stripeColors,
//     tileMeters — exactly the values the old maps held.
//   * PBR params (roughness/metalness/clearcoat/sheen/pileHeightMm/
//     stripeDirectionDeg/anisotropy/normalScale) — the physical description a
//     MeshStandard/Physical material maps onto 1:1, and from which the 2D layer
//     can derive its sheen/gradient. Renderer adoption of these is incremental
//     (Phase 5/6); they are additive and read by nothing yet, so no render
//     changes today.
export type FinishMaterial = {
  // 2D + sample-callout data (the historical parallel-map values).
  solidColor?: string;
  imageUrl?: string;
  turfImages?: { light: string; dark: string };
  stripeColors?: { light: string; dark: string };
  tileMeters?: number;
  // PBR description (MeshStandard/Physical). roughness/metalness are 0..1.
  roughness: number;
  metalness: number;
  clearcoat?: number;
  sheen?: number;
  // Turf-only pile characterisation (informs 3D normal/height + 2D stripe).
  pileHeightMm?: number;
  stripeDirectionDeg?: number;
  anisotropy?: number;
  normalScale?: number;
};

export const FINISH_MATERIAL: Record<SurfaceFinish, FinishMaterial> = {
  // Plain earth — matte, no photo.
  plain: { roughness: 0.95, metalness: 0 },
  // Interlocking PPE tiles (30 cm) — photographed, semi-matte plastic.
  ppe_tile_red: {
    imageUrl: "/images/tiles/red-ppe-tile.jpg",
    tileMeters: 0.3,
    roughness: 0.7,
    metalness: 0,
  },
  // Acrylic hard-court coating — low roughness + a hint of clearcoat sheen.
  acrylic_blue: { solidColor: "#265a9a", roughness: 0.35, metalness: 0, clearcoat: 0.3 },
  acrylic_green: { solidColor: "#2f6d3a", roughness: 0.35, metalness: 0, clearcoat: 0.3 },
  // Artificial grass — light photo base + dark-photo stripe for mow direction;
  // stripe tones (P1-04 spread) for the 2D plan; high roughness, tall pile.
  turf_40mm: {
    solidColor: "#2f8c3e",
    turfImages: {
      light: "/images/tiles/40 mm light green.jpg",
      dark: "/images/tiles/40 mm dark green.jpg",
    },
    stripeColors: { light: "#42a854", dark: "#20602a" },
    tileMeters: 1.0,
    roughness: 0.9,
    metalness: 0,
    pileHeightMm: 40,
    stripeDirectionDeg: 0,
    anisotropy: 8,
    normalScale: 0.8,
  },
  turf_50mm: {
    solidColor: "#2f8c3e",
    turfImages: {
      light: "/images/tiles/50mm light green.webp",
      dark: "/images/tiles/50 mm dark green1.webp",
    },
    stripeColors: { light: "#42a854", dark: "#20602a" },
    tileMeters: 1.0,
    roughness: 0.9,
    metalness: 0,
    pileHeightMm: 50,
    stripeDirectionDeg: 0,
    anisotropy: 8,
    normalScale: 0.9,
  },
  // PVC sports flooring — photo + green solid fallback (matches the sample
  // photo so the fill stays coherent if the image fails to load).
  pvc_sports: {
    solidColor: "#3ea867",
    imageUrl: "/images/tiles/pvc-sports.jpg",
    tileMeters: 1.0,
    roughness: 0.5,
    metalness: 0,
  },
};

// Derive the legacy parallel maps from FINISH_MATERIAL so existing consumers
// (CourtCanvas / CourtCanvas3D / wizard) are untouched. Only finishes that
// define the field appear in the derived map — reproducing each old map's exact
// key set + values.
function deriveFinishMap<T>(
  pick: (m: FinishMaterial) => T | undefined,
): Partial<Record<SurfaceFinish, T>> {
  const out: Partial<Record<SurfaceFinish, T>> = {};
  (Object.keys(FINISH_MATERIAL) as SurfaceFinish[]).forEach((k) => {
    const v = pick(FINISH_MATERIAL[k]);
    if (v !== undefined) out[k] = v;
  });
  return out;
}

// URL served by Next.js from /public for surfaces that render with a photograph
// in the sample callout. Acrylic surfaces have no image (solid colour).
export const SURFACE_IMAGE_URL = deriveFinishMap((m) => m.imageUrl);

// Turf finishes are laid as alternating light + dark rolls (mowed stripe
// effect). Each finish has TWO photographs — one per shade.
export const TURF_IMAGE_URLS = deriveFinishMap((m) => m.turfImages);

// Solid fill colour for surfaces that don't use a photograph — PlotSurface
// paints the plot with this and skips the sample-tile callout.
export const SURFACE_SOLID_COLOR = deriveFinishMap((m) => m.solidColor);

// Base stripe tones for turf. Rendered as alternating parallel stripes across
// the field length, mimicking a real mowed pattern (P1-04 widened the spread).
export const TURF_STRIPE_COLORS = deriveFinishMap((m) => m.stripeColors);

// P2-02: real-world size (in METRES) that ONE surface photo should cover when
// tiled across the 2D plot with fillPatternImage, so the material reads at true
// scale (a PPE tile is 30 cm; a turf/PVC texture repeats every ~1 m). Absent
// surfaces keep their solid fill (no photo tiling).
export const SURFACE_TILE_METERS = deriveFinishMap((m) => m.tileMeters);

// Which surfaces are counted as "tiled" (PPE tile family) vs a
// solid-coat material. Drives the tile-count pill visibility and the
// sample-tile callout in the design.
export function isTiledSurface(surface: SurfaceFinish): boolean {
  return surface === "ppe_tile_red";
}

export function isAcrylicSurface(surface: SurfaceFinish): boolean {
  return surface === "acrylic_blue" || surface === "acrylic_green";
}

// Ground finish → actual RGB. Used by CourtCanvas to override the
// stored groundColor when a modern finish is picked in the wizard.
// Undefined `finish` (old designs) falls back to whatever groundColor
// was saved (the sand tan default), keeping legacy layouts unchanged.
export const GROUND_FINISH_COLOR: Record<
  "sand" | "concrete" | "grass" | "white",
  string
> = {
  sand: "#9c845b",
  concrete: "#94A3B8",
  grass: "#5C7C3D",
  white: "#F1F3F5",
};

// Infer the canvas SurfaceFinish from a flooring product's category +
// name, so picking a real catalogue product still drives the 2D/3D
// render (turf stripes, acrylic solid, tile pattern, etc.). Falls back
// to "plain" when nothing matches — sales can then pick an appearance
// manually.
export function surfaceFromProduct(
  category: string | null | undefined,
  name: string,
): SurfaceFinish {
  const hay = `${category ?? ""} ${name}`.toLowerCase();
  if (/50\s*mm/.test(hay) && /turf|grass/.test(hay)) return "turf_50mm";
  if (/turf|grass|artificial/.test(hay)) return "turf_40mm";
  if (/acrylic|hard\s*court|itf/.test(hay))
    return /green/.test(hay) ? "acrylic_green" : "acrylic_blue";
  if (/ppe|tile|interlock/.test(hay)) return "ppe_tile_red";
  if (/pvc|vinyl/.test(hay)) return "pvc_sports";
  return "plain";
}

export function resolveGroundColor(
  finish: "sand" | "concrete" | "grass" | "white" | undefined,
  fallback: string,
  override?: string,
): string {
  if (override) return override;
  if (!finish) return fallback;
  return GROUND_FINISH_COLOR[finish];
}

// Darken a hex colour by the given factor (0.88 = 12% darker, 0.75 =
// 25% darker). Used to render the run-off zone in a subtly different
// shade of the base surface colour so playing area vs plot reads at a
// glance. Returns the input unchanged for non-hex inputs.
export function shadeHexColor(hex: string, factor: number): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((n & 0xff) * factor)));
  const out = (r << 16) | (g << 8) | b;
  return "#" + out.toString(16).padStart(6, "0");
}

export function runOffFactor(
  tone: "off" | "subtle" | "distinct" | undefined,
): number {
  // Sales asked for a modestly darker run-off zone — 20% for subtle,
  // 30% for distinct — so the split reads on both light and dark
  // surfaces (e.g. blue acrylic vs green turf).
  return tone === "distinct" ? 0.7 : tone === "subtle" ? 0.8 : 1;
}

export function isTurfSurface(surface: SurfaceFinish): boolean {
  return surface === "turf_40mm" || surface === "turf_50mm";
}

export function isPvcSurface(surface: SurfaceFinish): boolean {
  return surface === "pvc_sports";
}

// PVC sports flooring is sold by the square metre. Rolls typically
// come in 1.8 m wide × 20 m long; this helper returns total m² and a
// suggested roll count so sales can quote off both.
export const PVC_ROLL_WIDTH_M = 1.8;
export const PVC_ROLL_LENGTH_M = 20;
export function pvcRollCount(
  plotLengthFt: number,
  plotWidthFt: number
): { totalSqM: number; rolls: number; runningMeters: number } {
  const FT_PER_M = 3.281;
  const lengthM = plotLengthFt / FT_PER_M;
  const widthM = plotWidthFt / FT_PER_M;
  const totalSqM = Math.round(lengthM * widthM);
  const rolls = Math.ceil(widthM / PVC_ROLL_WIDTH_M);
  const runningMeters = Math.round(rolls * lengthM);
  return { totalSqM, rolls, runningMeters };
}

// Artificial-grass roll dimensions in metres. India market standard —
// most suppliers ship 2 m wide × 25 m long rolls. If a different size
// is used for a specific project, sales quotes off the raw roll-metres
// number and adjusts.
export const TURF_ROLL_WIDTH_M = 2;
export const TURF_ROLL_LENGTH_M = 25;

// Alternating light + dark stripes parallel to the field length. Each
// stripe occupies one roll width (2 m). Half the stripes are light,
// half dark — total meters per colour = (numStripes ÷ 2) × field length.
export function turfRollMeters(
  plotLengthFt: number,
  plotWidthFt: number
): {
  stripes: number;
  lightMeters: number;
  darkMeters: number;
  totalMeters: number;
  lightRolls: number;
  darkRolls: number;
} {
  const FT_PER_M = 3.281;
  const lengthM = plotLengthFt / FT_PER_M;
  const widthM = plotWidthFt / FT_PER_M;
  const stripes = Math.ceil(widthM / TURF_ROLL_WIDTH_M);
  const lightStripes = Math.ceil(stripes / 2);
  const darkStripes = stripes - lightStripes;
  const lightMeters = Math.round(lightStripes * lengthM);
  const darkMeters = Math.round(darkStripes * lengthM);
  return {
    stripes,
    lightMeters,
    darkMeters,
    totalMeters: lightMeters + darkMeters,
    lightRolls: Math.ceil(lightMeters / TURF_ROLL_LENGTH_M),
    darkRolls: Math.ceil(darkMeters / TURF_ROLL_LENGTH_M),
  };
}

// Acrylic hard-court coating quantities. A regulation build-up is:
//   1 × primer coat            (~ 4 sqft / L)
//   2 × resurfacer coats       (~ 3 sqft / L each)
//   2 × colour coats           (~ 5 sqft / L each)
// Line paint is negligible and quoted separately.
export function acrylicLitres(
  areaSqFt: number
): { primer: number; resurfacer: number; color: number; total: number } {
  const primer = Math.ceil(areaSqFt / 4);
  const resurfacer = Math.ceil((areaSqFt * 2) / 3);
  const color = Math.ceil((areaSqFt * 2) / 5);
  return { primer, resurfacer, color, total: primer + resurfacer + color };
}

// Real-world size of one PPE tile in feet (30 cm ≈ 0.984 ft).
export const PPE_TILE_FT = 0.984;

// Ceil-based tile count for a plot at 30 cm tile size. Sales quotes
// off this. Ceiling because partial edges need a full tile anyway.
export function ppeTileCount(
  plotLengthFt: number,
  plotWidthFt: number
): { perLength: number; perWidth: number; total: number } {
  const perLength = Math.ceil(plotLengthFt / PPE_TILE_FT);
  const perWidth = Math.ceil(plotWidthFt / PPE_TILE_FT);
  return { perLength, perWidth, total: perLength * perWidth };
}

export type Style = {
  // Background outside the court (the "earth" around the plot edge).
  groundColor: string;
  // Default colors used by elements that don't override.
  grassColor: string;
  lineColor: string;
  cricketPitchColor: string;
  basketballSurfaceColor: string;
  pickleballSurfaceColor: string;
  // Whether to draw the two-tone mowed-stripe pattern on grass.
  grassStripes: boolean;
  // When true, plot dimensions are drawn outside the plot footprint with
  // arrows + labels (e.g. "80 ft" along the top, "60 ft" along the side).
  // Customers asked for this so the exported image includes a sense of scale.
  showDimensions: boolean;
  // Surface finish inside the plot footprint. Drives whether we paint a
  // solid earth colour or tile a real PPE-tile photograph across the plot.
  surface: SurfaceFinish;
  // Whether to overlay a 2-ft measurement grid on the plot. Old designs
  // rendered the grid always-on. Sales asked for it OFF by default on
  // continuous-surface finishes (acrylic, turf, PVC) because customers
  // read the grid as a tile pattern. Still ON by default for PPE tile
  // (where the grid maps to real physical tile edges) and Plain. When
  // undefined (old designs stored before this field existed), CourtCanvas
  // falls back to true — no visual change to anything already saved.
  showGrid?: boolean;
  // Ground finish behind the plot. Only applied when set; undefined
  // uses the raw groundColor above so existing designs keep their
  // sand-tan background exactly as saved. Sales asked for "concrete"
  // as a more realistic default going forward (matches most Fitoverse
  // builds); "grass" is offered for outdoor turf scenes.
  groundFinish?: "sand" | "concrete" | "grass" | "white";
  // Visual distinction between playing area and run-off zone. When
  // "subtle" the run-off (plot ring around the sport court) tints 20%
  // darker than the playing area; "distinct" tints 30% darker. Old
  // designs stored before this field existed render as they always
  // have (undefined = no split, plot is one flat colour).
  runOffTone?: "off" | "subtle" | "distinct";
  // Optional explicit run-off zone colour override. When set, this hex
  // colour is used as the plot fill instead of the auto-darkened shade
  // derived from runOffTone. Lets sales and admin dial in exact tones
  // that match the customer's real construction site photo or brand
  // palette. Leave undefined to use the auto shade.
  runOffColorOverride?: string;
  // Optional custom hex colour that replaces the plot's SURFACE fill
  // (the un-darkened, non-run-off part). Useful when the customer
  // wants a specific brand colour that isn't in the acrylic /
  // ppe / turf / pvc presets. When undefined, the surface renders
  // with its stock colour.
  surfaceColorOverride?: string;
  // Optional custom hex colour for the GROUND (area outside the plot
  // footprint). Overrides the groundFinish dropdown when set — lets
  // sales pick any exact ground tone rather than sand / concrete /
  // grass.
  groundColorOverride?: string;
  // Base work under the flooring — "concrete" | "asphalt" | undefined.
  // Chosen in Step 1; informational (surfaces in the combined PDF /
  // quote). Doesn't change the canvas render.
  baseWork?: "concrete" | "asphalt";
  // Linked flooring product from the internal catalogue (Phase B).
  // Selected in Step 1's flooring picker. The canvas surface finish is
  // inferred from the product; these fields carry the reference through
  // to the combined PDF so it lists the exact product.
  flooringProductId?: string;
  flooringProductName?: string;
  // Hero image of the linked flooring product — shown in the canvas
  // callout so the customer sees the actual product they're getting.
  flooringProductImageUrl?: string;
  // Optional plot-boundary (border) colour. When set, the plot outline /
  // court-box border draws in this hex instead of the default brown frame.
  // A dedicated "Border colour" control in the wizard sets it.
  borderColor?: string;
  // Optional highlight colour for the kitchen / non-volley zone (pickleball)
  // — filled translucently so the zone reads at a glance. Only meaningful for
  // sports that have a kitchen (pickleball, badminton service area); ignored
  // by football / cricket / basketball.
  kitchenColor?: string;
  // V1: per-area highlight fills for basketball, rendered translucently
  // BEHIND the court markings (like the line-marking colour). Undefined = no
  // fill. These replaced the generic "Highlights" tool for basketball's three
  // key areas — the 3-point D, the free-throw lane (key/paint), and the
  // centre / jump-ball circle.
  basketball3ptColor?: string;
  basketballKeyColor?: string;
  basketballCircleColor?: string;
  // Optional watermark (logo URL + opacity).
  watermarkUrl?: string;
  watermarkOpacity?: number;
  // P4-01: optional PBR override for the plot SURFACE finish. Undefined on
  // every saved layout, so the surface keeps deriving its look from `surface`
  // (SurfaceFinish → FINISH_MATERIAL). When set, a future renderer can override
  // the finish's stock roughness/sheen/maps for a bespoke material without a
  // new SurfaceFinish enum value.
  surfaceMaterial?: MaterialSpec;
  // P6-01 — scene time-of-day for the 3D preview. "day" (default / undefined)
  // keeps the bright sky; "evening" and "night" dim the sun + sky + ambient so
  // any floodlight masts read as the light source (floodlit evening scene).
  // 2D is unaffected; existing layouts render as day.
  timeOfDay?: "day" | "evening" | "night";
};

export const DEFAULT_STYLE: Style = {
  groundColor: "#9c845b",
  grassColor: "#2f8c3e",
  lineColor: "#ffffff",
  cricketPitchColor: "#b1683a",
  basketballSurfaceColor: "#c97a4b",
  pickleballSurfaceColor: "#3e7fb7",
  grassStripes: true,
  showDimensions: true,
  surface: "plain",
  // Ground/earth around the plot is white by default (V1 — hardcoded, no UI
  // control). resolveGroundColor (2D) and the CourtCanvas3D switch both map
  // "white" → #F1F3F5.
  groundFinish: "white",
  // Fitoverse-branded layouts ship with the logo composited into the
  // bottom-right of every exported image / video. The user can clear
  // watermarkUrl in the wizard to remove it.
  watermarkUrl: "/quotation-assets/image1.png",
  watermarkOpacity: 0.9,
};

export type CourtLayout = {
  // Schema version — bump when shape changes incompatibly so we can
  // migrate older stored layouts on read.
  v: 1;
  plot: Plot;
  // Convenience copy of the sports the wizard generated this layout for.
  // The renderer doesn't trust this — actual marks come from the elements.
  // Mainly used by the UI title bar + list view chips.
  sports: Sport[];
  // Which sport reads as "primary" on a multi-sport plot. Drives z-order
  // (primary drawn on top) + the auto-colour palette. Optional so single-
  // sport designs and pre-multisport-refactor layouts stay untouched.
  primarySport?: Sport;
  elements: Element[];
  style: Style;
  // V1: user-set distance (ft) between tiled courts on a multi-court plot.
  // Undefined = the original auto layout (leftover per cell = run-off). When
  // set, retileCourts sizes courts to fit with this gap between them and
  // centres the grid block.
  courtGapFt?: number;
  // Optional title shown in the canvas header (the layout name the user
  // sees, e.g. "Dr Prabhusankar — 60x100 ft turf"). Persisted alongside
  // customerName on the CourtImage row.
  title?: string;
  // Catalogue items attached to this design (Phase E). Selected in the
  // Step 2 sidebar's Products / TDS / Equipment tabs, included in the
  // combined PDF (Phase F). IDs reference the internal Product / TdsFile
  // tables. Optional so pre-existing designs open unchanged.
  attachments?: {
    productIds: string[];
    equipmentIds: string[];
    tdsIds: string[];
  };
};

// Distinct fill colour per sport for multi-sport plots. Matches the TSS
// reference photo the user shared: basketball blue, volleyball / pickleball
// grey, football / cricket green, tennis green, badminton sand. When a
// layout has 2+ sports, buildInitialLayout applies these as each element's
// surfaceColor so sales sees the colour-coded zones the customer will get.
// Single-sport designs skip this so their existing look is unchanged.
// Distinct fill per sport so overlaid courts never share a colour (the old
// palette made volleyball + pickleball near-identical greys). Editable
// per-court in the wizard's "Court colours" section.
export const MULTISPORT_ZONE_COLOR: Record<Sport, string> = {
  basketball: "#1E60A8", // blue
  volleyball: "#C0563B", // terracotta
  pickleball: "#1E8A8A", // teal
  tennis: "#3D7A47", // green
  badminton: "#C4A66A", // sand
  football: "#3E8A47", // turf green
  cricket: "#3E8A47", // turf green
  multisport: "#6B7280", // grey
};

// Distinct LINE-MARKING colour per sport on a multi-sport surface, so overlaid
// courts' lines are told apart by colour (gym-floor convention). Bright/high-
// contrast so they read on the coloured court fills. Applied per court in
// buildInitialLayout; overridable via the per-court line colour.
export const MULTISPORT_LINE_COLOR: Record<Sport, string> = {
  basketball: "#EF4444", // red
  volleyball: "#FDE047", // yellow
  pickleball: "#38BDF8", // sky blue
  tennis: "#F97316", // orange
  badminton: "#FFFFFF", // white
  football: "#FFFFFF", // white
  cricket: "#FDE047", // yellow
  multisport: "#FFFFFF",
};

// Preset kitchen / non-volley (net-zone) colour per sport — shown by default
// so the zone is always highlighted, and still overridable via the wizard's
// "Kitchen / net zone" picker (style.kitchenColor wins when set). V1: ONLY
// pickleball keeps a filled kitchen zone. Tennis / badminton / volleyball no
// longer highlight a service / attack band, and football / cricket / basketball
// never had one.
export const KITCHEN_DEFAULT_COLOR: Partial<Record<Sport, string>> = {
  pickleball: "#C0563B", // terracotta kitchen (classic pickleball look)
};

// Preset non-playing (run-off) ring colour per sport — auto-applied as the
// plot-fill default so the run-off reads distinct from the court, and still
// overridable via the wizard's "Non-playing (run-off) colour" picker
// (style.runOffColorOverride wins). Darker tones of each sport's court colour
// so court + surround read as one scheme. Turf sports (football / cricket)
// keep their grass and are absent.
export const RUNOFF_DEFAULT_COLOR: Partial<Record<Sport, string>> = {
  basketball: "#2C4A6E", // deep blue
  volleyball: "#6E3C2C", // deep terracotta
  pickleball: "#1C5A5A", // deep teal
  tennis: "#2C4A34", // deep green
  badminton: "#5A4A2C", // deep sand
};

// ─────────────────────────────────────────────────────────────────────
//  Defaults + initial layout generator
// ─────────────────────────────────────────────────────────────────────

// A-side proportional configs — football fields scale their markings off
// these so the same renderer covers 5/7/11-a-side turfs without per-side
// code paths. All values are *fractions of field width/height*.
//
// P4-05: the 11-a-side proportions were corrected to the IFAB Laws of the Game
// (105 × 68 m). This INTENTIONALLY changes how 11-a-side football renders (2D
// and 3D read these ratios live at draw time, so re-rendering a saved 11-a-side
// design will reflect the fix). Do NOT silently re-render / re-cache designs
// already sent to a customer — leave those on their existing PDF. 5- and
// 7-a-side are unchanged.
//
//   penaltyBoxHeightRatio  40.32 m / 68 m = 0.593  (was 0.66)
//   goalAreaHeightRatio     18.32 m / 68 m = 0.269  (was 0.36)
//   centerCircleRadiusRatio  9.15 m / 68 m = 0.135  (was 0.15, radius of min side)
//
// `lineWidthFt` is the real IFAB pitch-line width (12 cm ≈ 0.394 ft) carried as
// data for a future true-scale line renderer; it is NOT consumed yet, so line
// weights are unchanged in this phase.
const A_SIDE_PROPS = {
  5: {
    penaltyBoxWidthRatio: 0.16, // along x (length)
    penaltyBoxHeightRatio: 0.55, // along y (width)
    goalAreaWidthRatio: 0.07,
    goalAreaHeightRatio: 0.25,
    centerCircleRadiusRatio: 0.12,
    goalWidthRatio: 0.17,
    lineWidthFt: 0.394,
  },
  7: {
    penaltyBoxWidthRatio: 0.18,
    penaltyBoxHeightRatio: 0.6,
    goalAreaWidthRatio: 0.075,
    goalAreaHeightRatio: 0.3,
    centerCircleRadiusRatio: 0.14,
    goalWidthRatio: 0.18,
    lineWidthFt: 0.394,
  },
  11: {
    penaltyBoxWidthRatio: 0.165,
    penaltyBoxHeightRatio: 0.593,
    goalAreaWidthRatio: 0.055,
    goalAreaHeightRatio: 0.269,
    centerCircleRadiusRatio: 0.135,
    goalWidthRatio: 0.12,
    lineWidthFt: 0.394,
  },
};

export function aSideProps(side: 5 | 7 | 11) {
  return A_SIDE_PROPS[side];
}

let _idCounter = 0;
function newId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${_idCounter.toString(36)}`;
}

// Pick a sensible a-side from plot dimensions. Tiny plots = 5-a-side,
// regulation = 11. The user can change this in the wizard.
export function defaultASide(plot: Plot): 5 | 7 | 11 {
  const area = plot.lengthFt * plot.widthFt;
  if (area < 8000) return 5;
  if (area < 30000) return 7;
  return 11;
}

export type InitialLayoutInput = {
  plot: Plot;
  sports: Sport[];
  // Per-sport overrides — only the keys that apply to the picked sports
  // are honored.
  config?: {
    football?: { aSide?: 5 | 7 | 11 };
    cricket?: { pitchLengthFt?: number; pitchWidthFt?: number; orientation?: "horizontal" | "vertical" };
    basketball?: { halfCourt?: boolean };
    pickleball?: { doubles?: boolean };
  };
  title?: string;
};

// Build the initial CourtLayout from a (plot, sports, config) input.
// Called by the wizard at the Step1 -> Step2 transition. The resulting
// layout is then handed to the editor, which mutates it as the user drags
// elements around.
// Scale a sport's regulation playing area to fit the entered plot,
// preserving the court's aspect ratio. Leaves a small margin (default
// 4 ft) so markings don't touch the plot edge.
//
// Called by buildInitialLayout for every sport. Previously each sport
// Court/field footprint element types — the drawn playing surfaces. Used to
// report court size + the non-playing area (plot minus court) on every design.
const COURT_FOOTPRINT_TYPES = new Set<string>([
  "football-field",
  "basketball-court",
  "pickleball-court",
  "generic-court",
]);

export type DesignAreas = {
  plot: { lengthFt: number; widthFt: number; areaSqFt: number };
  // `label` names the sport (Basketball, Tennis…) so the dimensions readout can
  // say WHICH court each playing area belongs to.
  courts: Array<{
    lengthFt: number;
    widthFt: number;
    areaSqFt: number;
    label: string;
  }>;
  courtCount: number;
  courtAreaSqFt: number;
  nonPlayingSqFt: number;
  // User-set spacing between tiled courts (ft), surfaced in the dimensions
  // readout. Undefined / 0 = the automatic layout.
  courtGapFt?: number;
};

// Plot size (entered), court size(s) (drawn playing surface) and the
// non-playing area = plot − court. Shown as a readout on every canvas design.
export function computeDesignAreas(layout: CourtLayout): DesignAreas {
  const lengthFt = layout.plot.lengthFt;
  const widthFt = layout.plot.widthFt;
  // For a non-rectangular plot (curved / cut turf shape) the actual surfaced
  // area is the polygon area, not the L × W bounding box — so turf quantity
  // and the run-off readout stay correct for ovals, Cricket-D, etc.
  const poly = layout.plot.polygon;
  const plotAreaSqFt =
    poly && poly.length >= 3 ? polygonAreaSqFt(poly) : lengthFt * widthFt;

  // Name each court by its sport so the dimensions readout reads
  // "Basketball — 92 × 49 ft" rather than a bare "Playing area".
  const courtLabel = (e: Element): string => {
    if (e.type === "basketball-court") return "Basketball";
    if (e.type === "football-field") return "Football";
    if (e.type === "pickleball-court") return "Pickleball";
    if (e.type === "cricket-pitch") return "Cricket pitch";
    if (e.type === "generic-court" && "sport" in e) {
      const s = String((e as { sport?: string }).sport ?? "");
      return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Court";
    }
    return "Court";
  };

  const courts = layout.elements
    // The cricket-pitch is included too — it stores pitchLengthFt/pitchWidthFt
    // (not width/height), so it needs its own size read to appear in the table.
    .filter((e) => COURT_FOOTPRINT_TYPES.has(e.type) || e.type === "cricket-pitch")
    .map((e) => {
      let w: number;
      let h: number;
      if (e.type === "cricket-pitch") {
        const cp = e as { pitchLengthFt?: number; pitchWidthFt?: number };
        w = cp.pitchLengthFt ?? 0;
        h = cp.pitchWidthFt ?? 0;
      } else {
        w = "width" in e ? (e as { width?: number }).width ?? 0 : 0;
        h = "height" in e ? (e as { height?: number }).height ?? 0 : 0;
      }
      return {
        lengthFt: Math.max(w, h),
        widthFt: Math.min(w, h),
        areaSqFt: w * h,
        label: courtLabel(e),
      };
    })
    .filter((c) => c.areaSqFt > 0);

  // Concentric multisport courts overlap, so their footprint is the LARGEST
  // court, not the sum. Side-by-side courts of a single sport don't overlap,
  // so sum them.
  const concentric = layout.sports.length > 1;
  const courtAreaSqFt = concentric
    ? courts.reduce((m, c) => Math.max(m, c.areaSqFt), 0)
    : courts.reduce((s, c) => s + c.areaSqFt, 0);

  return {
    plot: { lengthFt, widthFt, areaSqFt: plotAreaSqFt },
    courts,
    courtCount: courts.length,
    courtAreaSqFt,
    courtGapFt: layout.courtGapFt,
    nonPlayingSqFt: Math.max(0, plotAreaSqFt - courtAreaSqFt),
  };
}

function fitCourtToPlot(
  playLength: number,
  playWidth: number,
  longFt: number,
  shortFt: number,
  marginFt: number = 4,
): { courtW: number; courtH: number } {
  const availableL = Math.max(1, longFt - marginFt);
  const availableW = Math.max(1, shortFt - marginFt);
  const courtAspect = playLength / playWidth;
  const availableAspect = availableL / availableW;
  if (availableAspect > courtAspect) {
    // Plot is wider than the court's aspect — fit to the short side.
    const courtH = availableW;
    return { courtW: courtH * courtAspect, courtH };
  }
  // Plot is narrower (or equal) — fit to the long side.
  const courtW = availableL;
  return { courtW, courtH: courtW / courtAspect };
}

// Draw the court at its EXACT regulation playing-area size (governing-body
// dimensions), only scaling DOWN if the plot is smaller than the court — never
// scaling up to "fill" the plot. This keeps the marked playing area precise
// (e.g. a 7-a-side pitch stays 180 × 120 ft / 54.86 × 36.58 m), with the plot's
// leftover space forming the run-off. When the plot equals a preset's total
// (playing area + the governing-body run-off), the run-off comes out exactly
// right too.
function courtExactSize(
  playLengthFt: number,
  playWidthFt: number,
  longFt: number,
  shortFt: number,
): { courtW: number; courtH: number } {
  const scale = Math.min(1, longFt / playLengthFt, shortFt / playWidthFt);
  return { courtW: playLengthFt * scale, courtH: playWidthFt * scale };
}

// Court sizes (ft) per sport used by retileCourts to tile + size courts.
// P4-03: sourced from the canonical SPORT_DIMS registry. NOTE football uses the
// CAPACITY footprint (197 × 131 — the 7-a-side representative pitch you actually
// tile), NOT the 344 × 223 drawing size; the other sports use their nominal
// drawing size. Values are byte-identical to the previous literal (football
// 197×131, volleyball 59×30, badminton 44×20, …).
const COURT_REG: Partial<Record<Sport, { l: number; w: number }>> = {
  football: SPORT_DIMS.football.capacity,
  basketball: SPORT_DIMS.basketball.drawing,
  tennis: SPORT_DIMS.tennis.drawing,
  volleyball: SPORT_DIMS.volleyball.drawing,
  pickleball: SPORT_DIMS.pickleball.drawing,
  badminton: SPORT_DIMS.badminton.drawing,
};

// How many regulation courts of a sport fit in the plot (best of either
// orientation), leaving ~4 m of shared run-off / walkway between them.
// Max courts of a sport a plot can hold, at the recreational (tight-but-
// playable) preset. Delegates to the packing predictor so tiling and the
// capacity banner share one source of truth (both orientations, per-sport
// run-off). predictCapacity also exposes the competition count + tight flag.
export function courtCapacity(
  plotLengthFt: number,
  plotWidthFt: number,
  sport: Sport,
): number {
  return predictCapacity(plotLengthFt, plotWidthFt, sport).recreational;
}

// Choose the columns × rows grid (cols*rows >= count) that lets regulation-
// aspect courts fill their cells best.
function chooseCourtGrid(
  plotLengthFt: number,
  plotWidthFt: number,
  reg: { l: number; w: number },
  count: number,
): { cols: number; rows: number } {
  let best = { cols: count, rows: 1, cov: -1 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellW = plotLengthFt / cols;
    const cellH = plotWidthFt / rows;
    const { courtW, courtH } = fitCourtToPlot(reg.l, reg.w, cellW, cellH, 8);
    const cov = (courtW * courtH) / (cellW * cellH);
    if (cov > best.cov) best = { cols, rows, cov };
  }
  return { cols: best.cols, rows: best.rows };
}

// Re-lay the primary sport as `count` regulation courts tiled across the plot,
// each independently editable. Keeps user-added elements; drops the old court
// surface(s) + their auto hoops/nets. For basketball, re-adds a hoop at each
// court end so every court still looks complete.
export function retileCourts(layout: CourtLayout, count: number): CourtLayout {
  const courtEls = layout.elements.filter((e) =>
    COURT_FOOTPRINT_TYPES.has(e.type),
  );
  if (courtEls.length === 0) return layout;
  const template = courtEls[0];
  const sport = (layout.primarySport ?? layout.sports[0]) as Sport;
  const reg = COURT_REG[sport];
  if (!reg) return layout;

  const plotL = layout.plot.lengthFt;
  const plotW = layout.plot.widthFt;
  const n = Math.max(1, Math.min(count, courtCapacity(plotL, plotW, sport)));
  const { cols, rows } = chooseCourtGrid(plotL, plotW, reg, n);
  const cellW = plotL / cols;
  const cellH = plotW / rows;
  // Optional user-set spacing between courts (ft). Default (null) keeps the
  // original cell-centred layout (leftover per cell = auto run-off). When set,
  // courts are sized to fit the space left after reserving `gapFt` between
  // them, and the tight grid block is centred in the plot.
  const gapFt =
    layout.courtGapFt && layout.courtGapFt > 0 ? layout.courtGapFt : null;
  const availW = gapFt ? (plotL - (cols - 1) * gapFt) / cols : cellW;
  const availH = gapFt ? (plotW - (rows - 1) * gapFt) / rows : cellH;
  const { courtW, courtH } = courtExactSize(reg.l, reg.w, availW, availH);
  const blockW = cols * courtW + (gapFt ? (cols - 1) * gapFt : 0);
  const blockH = rows * courtH + (gapFt ? (rows - 1) * gapFt : 0);
  const startX = gapFt ? Math.max(0, (plotL - blockW) / 2) : 0;
  const startY = gapFt ? Math.max(0, (plotW - blockH) / 2) : 0;
  const centreX = (col: number) =>
    gapFt ? startX + col * (courtW + gapFt) + courtW / 2 : (col + 0.5) * cellW;
  const centreY = (row: number) =>
    gapFt ? startY + row * (courtH + gapFt) + courtH / 2 : (row + 0.5) * cellH;

  // Keep everything except the old court surfaces + their auto equipment.
  const kept = layout.elements.filter(
    (e) =>
      !COURT_FOOTPRINT_TYPES.has(e.type) &&
      e.type !== "basketball-hoop" &&
      e.type !== "net",
  );

  const isBasketball = template.type === "basketball-court";
  const halfCourt =
    isBasketball && (template as { halfCourt?: boolean }).halfCourt === true;

  // Net sports keep a regulation net per court. The `kept` filter above strips
  // the original nets, and only basketball used to re-add its equipment, so
  // retiling a tennis/badminton/volleyball/pickleball design silently lost the
  // net on every court. Re-add one centred on each tiled court.
  const NET_HEIGHT_FT: Partial<Record<Sport, number>> = {
    pickleball: 3,
    tennis: 3.5,
    badminton: 5,
    volleyball: 7.9,
  };
  const netHeight = NET_HEIGHT_FT[sport];

  const added: Element[] = [];
  let z = 1;
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ccx = centreX(col);
    const ccy = centreY(row);
    // Copy the template court so sport-specific props (halfCourt, aSide,
    // surfaceColor…) carry over; override position/size + reset rotation.
    added.push({
      ...(template as unknown as Record<string, unknown>),
      id: newId(sport),
      x: ccx,
      y: ccy,
      rotation: 0,
      width: courtW,
      height: courtH,
      z: z++,
    } as unknown as Element);

    if (isBasketball) {
      const basketFromBaselineFt = 5.17;
      const dirs = halfCourt ? [1] : [-1, 1];
      for (const dir of dirs) {
        added.push({
          id: newId("hoop"),
          type: "basketball-hoop",
          x: ccx + (dir * courtW) / 2 - dir * basketFromBaselineFt,
          y: ccy,
          rotation: dir < 0 ? -90 : 90,
          poleHeightFt: 10,
          backboardWidthFt: 6,
          z: z + 40,
        } as unknown as Element);
      }
    } else if (netHeight) {
      // Net spans the court's short side (courtH), perpendicular to play.
      added.push({
        id: newId(`${sport}-net`),
        type: "net",
        x: ccx,
        y: ccy,
        rotation: 90,
        widthFt: courtH,
        heightFt: netHeight,
        z: z + 30,
      } as unknown as Element);
    }
  }

  return { ...layout, elements: [...kept, ...added] };
}

export function buildInitialLayout(input: InitialLayoutInput): CourtLayout {
  const { plot, sports, config = {} } = input;
  const cx = plot.lengthFt / 2;
  const cy = plot.widthFt / 2;
  const elements: Element[] = [];
  let z = 1;

  // Plots come in any shape (60×130, 80×60, 100×60, …). Court sports
  // are naturally LANDSCAPE — length always >= width. To avoid stretching
  // a football pitch into a tall thin rectangle when the user enters a
  // portrait plot (width > length), we orient every full-court element
  // along the plot's LONG side. The element's `width` always tracks the
  // long side; `rotation: 90` is applied when the plot is portrait so
  // the visible footprint still fills the plot correctly.
  const isPortrait = plot.widthFt > plot.lengthFt;
  const longFt = Math.max(plot.lengthFt, plot.widthFt);
  const shortFt = Math.min(plot.lengthFt, plot.widthFt);
  const baseRotation = isPortrait ? 90 : 0;
  // Courts are drawn at their EXACT governing-body playing-area size
  // (courtExactSize), so the run-off is simply the plot's leftover space
  // around them — no fixed margin needed. When the plot equals a preset's
  // total, that leftover comes out to the exact governing-body run-off.

  // Largest sport renders on the bottom of the stack. Football and the
  // other full-court sports compete for "base"; cricket is always an
  // overlay so it sits on top.
  const hasFootball = sports.includes("football");
  const hasBasketball = sports.includes("basketball");
  const hasPickleball = sports.includes("pickleball");
  const hasCricket = sports.includes("cricket");
  const hasMultisport = sports.includes("multisport");

  if (hasFootball) {
    const aSide = config.football?.aSide ?? defaultASide(plot);
    // FIFA playing areas centred inside the plot so the 2 m run-off
    // (the safety zone the wizard's preset already reserves) shows as
    // space around the pitch instead of the field bleeding into it.
    //   5-a-side  : 40 × 20 m ≈ 131 × 66 ft
    //   7-a-side  : 60 × 40 m ≈ 197 × 131 ft
    //   11-a-side : 105 × 68 m ≈ 344 × 223 ft
    // Playing-area sizes (ft) per format — P4-03: from the canonical
    // FOOTBALL_PLAY_SIZES registry (exact metric → ft, so the drawn pitch
    // matches to < 0.1 m). Byte-identical to the previous inline literal.
    const ps = FOOTBALL_PLAY_SIZES[aSide];
    // Draw the pitch at its EXACT playing area (see courtExactSize) — the
    // plot's leftover forms the run-off. Old note (pre-exact-size): scaled
    // the FIFA playing area to fill the plot, which left the run-off on
    // custom plots).
    const { courtW: pitchL, courtH: pitchW } = courtExactSize(
      ps.l,
      ps.w,
      longFt,
      shortFt,
    );
    elements.push({
      id: newId("football"),
      type: "football-field",
      x: cx,
      y: cy,
      rotation: baseRotation,
      width: pitchL,
      height: pitchW,
      aSide,
      z: z++,
    });
  }

  if (hasBasketball && !hasFootball) {
    // Solo basketball: render the FIBA playing area (28 × 15 m ≈
    // 91.86 × 49.21 ft) centred on the plot. The plot's extra space
    // (2 m run-off on each side in the FIBA With Run-Off preset)
    // shows as the required unobstructed peripheral zone around the
    // markings. Half-court / 3x3 uses the smaller FIBA 3x3 playing
    // area (15 × 11 m ≈ 49.21 × 36.09 ft).
    const halfCourt = config.basketball?.halfCourt ?? false;
    // Playing-area dimensions per FIBA rulebook — used only to derive
    // the court's aspect ratio; the actual on-canvas court scales to
    // fill the entered plot.
    const playLength = halfCourt ? 49.21 : 91.86;
    const playWidth = halfCourt ? 36.09 : 49.21;
    const { courtW, courtH } = courtExactSize(
      playLength,
      playWidth,
      longFt,
      shortFt,
    );
    elements.push({
      id: newId("basketball"),
      type: "basketball-court",
      x: cx,
      y: cy,
      rotation: baseRotation,
      width: courtW,
      height: courtH,
      halfCourt,
      z: z++,
    });
    // Auto-add hoops flanking each end of the court so sales doesn't have
    // to remember to drop them in manually. Hoop offsets need to follow
    // the same rotation as the court so they line up with each end-line.
    const hoopOffsets = config.basketball?.halfCourt ? [1] : [-1, 1];
    for (const dir of hoopOffsets) {
      // Position the hoop along the court's long axis. When portrait we
      // rotated the court 90°, so the long axis points along Y in plot
      // space; otherwise along X.
      //
      // Real FIBA basket-centre distance from the baseline is 1.575 m
      // (≈ 5.17 ft). Placing the hoop element there so the backboard
      // sits just behind the baseline and the rim overhangs into the
      // court as it does on a real build.
      const basketFromBaselineFt = 5.17;
      const offset = (dir * courtW) / 2 - dir * basketFromBaselineFt;
      // Hoop rim faces INTO the court. Konva-local rim is at +y (down
      // on screen); rotating -90° maps +y onto +x (rim points RIGHT
      // for the left basket), and 90° maps +y onto -x (rim points LEFT
      // for the right basket). Both baskets end up pointing inward.
      elements.push({
        id: newId("hoop"),
        type: "basketball-hoop",
        x: isPortrait ? cx : cx + offset,
        y: isPortrait ? cy + offset : cy,
        rotation: baseRotation + (dir < 0 ? -90 : 90),
        poleHeightFt: 10,
        backboardWidthFt: 6,
        z: z + 20,
      });
    }
    z += 30;
  } else if (hasBasketball && hasFootball) {
    // Stacked with football — inset a smaller half-court in one corner.
    // Size + position derived from long/short so portrait plots get a
    // landscape-oriented inset, not a squished portrait one.
    const w = Math.min(50, longFt * 0.45);
    const h = Math.min(47, shortFt * 0.45);
    const offsetLong = longFt * 0.2;
    const offsetShort = shortFt * 0.2;
    elements.push({
      id: newId("basketball"),
      type: "basketball-court",
      x: isPortrait ? cx + offsetShort : cx - offsetLong,
      y: isPortrait ? cy + offsetLong : cy + offsetShort,
      rotation: baseRotation,
      width: w,
      height: h,
      halfCourt: true,
      z: z++,
    });
  }

  if (hasPickleball) {
    // Pickleball regulation is 44 × 20 ft — used for the aspect ratio.
    // Court fills the entered plot preserving that aspect.
    const { courtW, courtH } = courtExactSize(44, 20, longFt, shortFt);
    elements.push({
      id: newId("pickleball"),
      type: "pickleball-court",
      x: cx,
      y: cy,
      rotation: baseRotation,
      width: courtW,
      height: courtH,
      z: z++,
    });
    // Regulation pickleball net — 36" at the posts, 34" at centre; spans
    // the court's short side across the middle. Perpendicular to length
    // like the tennis/badminton/volleyball nets (rotate 90°).
    elements.push({
      id: newId("pickleball-net"),
      type: "net",
      x: cx,
      y: cy,
      rotation: baseRotation + 90,
      widthFt: courtH,
      heightFt: 3,
      z: z++,
    });
  }

  // Tennis / Badminton / Volleyball — each renders via generic-court
  // with a sport-specific default size (regulation dims from
  // sport-standards). A regulation net is dropped in at the centre.
  // Multi-sport friendly: any combination of these can be picked and
  // each gets its own element.
  const netTargets: Array<{
    sport: "tennis" | "badminton" | "volleyball";
    width: number;
    height: number;
    netHeightFt: number;
  }> = [];
  if (sports.includes("tennis")) {
    // Exact governing-body playing areas (ft): ITF 23.77 × 10.97 m,
    // BWF doubles 13.4 × 6.1 m, FIVB 18 × 9 m.
    netTargets.push({ sport: "tennis", width: 78, height: 36, netHeightFt: 3.5 });
  }
  if (sports.includes("badminton")) {
    netTargets.push({ sport: "badminton", width: 43.96, height: 20.01, netHeightFt: 5 });
  }
  if (sports.includes("volleyball")) {
    netTargets.push({ sport: "volleyball", width: 59.06, height: 29.53, netHeightFt: 7.9 });
  }
  for (const t of netTargets) {
    // Fill the plot preserving the sport's regulation aspect ratio so
    // custom-size plots don't get a tiny regulation court centred with
    // dead space around it.
    const { courtW: w, courtH: h } = courtExactSize(
      t.width,
      t.height,
      longFt,
      shortFt,
    );
    elements.push({
      id: newId(t.sport),
      type: "generic-court",
      sport: t.sport,
      x: cx,
      y: cy,
      rotation: baseRotation,
      width: w,
      height: h,
      z: z++,
    });
    // The net runs PERPENDICULAR to the court's length (crossing the
    // play direction), so its line spans the court's SHORT side (h).
    // NetShape draws a horizontal line by default; rotate 90° so it
    // becomes a vertical bar across the width, with posts at the
    // top and bottom sidelines where they physically sit on court.
    elements.push({
      id: newId(`${t.sport}-net`),
      type: "net",
      x: cx,
      y: cy,
      rotation: baseRotation + 90,
      widthFt: h,
      heightFt: t.netHeightFt,
      z: z++,
    });
  }

  if (hasMultisport && !hasFootball && !hasBasketball && !hasPickleball && netTargets.length === 0) {
    // Multisport surface (only when no other sport picked) — generic
    // coloured rectangle covering most of the plot, used as a base for
    // stacked markings.
    elements.push({
      id: newId("multisport"),
      type: "generic-court",
      sport: "multisport",
      x: cx,
      y: cy,
      rotation: baseRotation,
      width: longFt,
      height: shortFt,
      z: z++,
    });
  }

  if (hasCricket) {
    const pitchLengthFt = config.cricket?.pitchLengthFt ?? 66; // 22 yd default
    const pitchWidthFt = config.cricket?.pitchWidthFt ?? 10;
    // Default orientation follows the plot's long axis so the pitch
    // doesn't get clipped on portrait plots. The user can still flip it
    // explicitly via the wizard config.
    const defaultOrientation = isPortrait ? "vertical" : "horizontal";
    const orientation = config.cricket?.orientation ?? defaultOrientation;
    const rotation = orientation === "vertical" ? 90 : 0;
    elements.push({
      id: newId("cricket"),
      type: "cricket-pitch",
      x: cx,
      y: cy,
      rotation,
      // If the pitch doesn't fit, shrink to 85% of available dim.
      pitchLengthFt: Math.min(
        pitchLengthFt,
        (orientation === "vertical" ? plot.widthFt : plot.lengthFt) * 0.85
      ),
      pitchWidthFt,
      z: z++,
    });
  }

  // Multi-sport zone-colour palette. When 2+ sports on one plot, paint
  // each sport court in its distinct fill colour (matches the TSS
  // reference photo: basketball blue, volleyball / pickleball grey,
  // etc.). Skipped for single-sport plots so existing designs render
  // unchanged. Only applied to elements that don't already have a
  // surfaceColor set (so per-element overrides from re-opened designs
  // still win).
  const uniqueSports = new Set(sports);
  const isMultisport = uniqueSports.size >= 2;
  // Element `type` → sport mapping — reused by the palette + auto-layout.
  const sportForType = (type: string, sport?: string): Sport | null => {
    if (type === "basketball-court") return "basketball";
    if (type === "football-field") return "football";
    if (type === "pickleball-court") return "pickleball";
    if (type === "cricket-pitch") return "cricket";
    if (type === "generic-court" && sport) return sport as Sport;
    return null;
  };
  if (isMultisport) {
    for (const el of elements) {
      const s = sportForType(el.type, "sport" in el ? el.sport : undefined);
      if (!s) continue;
      // Distinct fill per sport (skip if the element already has one). NOTE:
      // the court literals are created WITHOUT a surfaceColor/lineColor key, so
      // a `"surfaceColor" in el` guard is always false and used to make this
      // whole per-sport palette dead. Check the value only.
      if (!(el as { surfaceColor?: string }).surfaceColor) {
        const palette = MULTISPORT_ZONE_COLOR[s];
        if (palette) (el as { surfaceColor?: string }).surfaceColor = palette;
      }
      // Distinct LINE colour per sport so overlaid courts' markings differ.
      if (!(el as { lineColor?: string }).lineColor) {
        const lc = MULTISPORT_LINE_COLOR[s];
        if (lc) (el as { lineColor?: string }).lineColor = lc;
      }
    }

    // Auto-layout — CONCENTRIC STACK. Draw the biggest court, then each
    // smaller court centred on top at its TRUE relative size, so a
    // multi-use surface reads like a real gym floor with nested markings
    // (basketball outermost, then tennis, volleyball, pickleball/
    // badminton inside it) instead of separate courts tiled side by side.
    //
    // Regulation playing-area dimensions (long × short, ft) used to
    // derive the relative sizes. P4-03: from SPORT_DIMS.*.drawing (the nominal
    // drawing size). Byte-identical to the previous literal (football 344×223,
    // volleyball 59×30, …).
    const REG: Partial<Record<Sport, { l: number; w: number }>> = {
      football: SPORT_DIMS.football.drawing,
      basketball: SPORT_DIMS.basketball.drawing,
      tennis: SPORT_DIMS.tennis.drawing,
      volleyball: SPORT_DIMS.volleyball.drawing,
      pickleball: SPORT_DIMS.pickleball.drawing,
      badminton: SPORT_DIMS.badminton.drawing,
    };
    // Court elements to stack (skip cricket-pitch overlay + multisport
    // base + nets). Keep a handle on each with its regulation size.
    const stack: Array<{
      el: { x?: number; y?: number; rotation?: number; width?: number; height?: number; z?: number };
      sport: Sport;
      reg: { l: number; w: number };
    }> = [];
    for (const el of elements) {
      const s = sportForType(el.type, "sport" in el ? el.sport : undefined);
      if (!s || s === "cricket" || s === "multisport") continue;
      const reg = REG[s];
      if (!reg) continue;
      stack.push({ el: el as (typeof stack)[number]["el"], sport: s, reg });
    }
    if (stack.length >= 2) {
      // Biggest regulation area is the reference and fills the plot.
      stack.sort((a, b) => b.reg.l * b.reg.w - a.reg.l * a.reg.w);
      const ref = stack[0];
      const { courtW: refLong } = fitCourtToPlot(ref.reg.l, ref.reg.w, longFt, shortFt);
      const scale = refLong / ref.reg.l; // canvas-ft per regulation-ft
      let stackZ = z; // biggest gets the lowest z (drawn first / underneath)
      const sizeBySport = new Map<Sport, { w: number; h: number }>();
      for (const s of stack) {
        s.el.x = cx;
        s.el.y = cy;
        s.el.rotation = baseRotation;
        s.el.width = s.reg.l * scale;
        s.el.height = s.reg.w * scale;
        s.el.z = stackZ++;
        sizeBySport.set(s.sport, { w: s.el.width, h: s.el.height });
      }
      // Re-centre each sport net onto the middle + size to that sport's
      // (now concentric) court short side. Net id is `${sport}-net`.
      for (const el of elements) {
        if (el.type !== "net" || !("id" in el)) continue;
        const netSport = (Object.keys(REG) as Sport[]).find((sp) =>
          (el.id as string).startsWith(`${sp}-`),
        );
        const sz = netSport ? sizeBySport.get(netSport) : undefined;
        if (!sz) continue;
        el.x = cx;
        el.y = cy;
        el.rotation = baseRotation + 90;
        (el as { widthFt?: number }).widthFt = sz.h;
        (el as { z?: number }).z = stackZ++;
      }
    }
  }

  // Default primary sport = the first picked sport. On a multi-sport
  // plot this reads as the "hero" court; the wizard's Primary Sport
  // dropdown lets sales flip which one is on top.
  const primarySport = sports[0];

  return {
    v: 1,
    plot,
    sports,
    primarySport,
    elements,
    style: { ...DEFAULT_STYLE },
    title: input.title,
  };
}

// ─────────────────────────────────────────────────────────────────────
//  Number generation
// ─────────────────────────────────────────────────────────────────────

export function buildCourtImageNumber(year: number, countThisYear: number): string {
  const seq = String(countThisYear + 1).padStart(3, "0");
  return `FIT-CIM-${year}-${seq}`;
}

// ─────────────────────────────────────────────────────────────────────
//  Element factories — used by the "Add element" menu in the editor
// ─────────────────────────────────────────────────────────────────────

export function newCricketPitch(plot: Plot): CricketPitchElement {
  return {
    id: newId("cricket"),
    type: "cricket-pitch",
    x: plot.lengthFt / 2,
    y: plot.widthFt / 2,
    rotation: 0,
    pitchLengthFt: Math.min(66, plot.lengthFt * 0.85),
    pitchWidthFt: 10,
    z: 100,
  };
}

export function newAnnotation(plot: Plot, text = "Label"): AnnotationElement {
  return {
    id: newId("anno"),
    type: "annotation",
    x: plot.lengthFt / 2,
    y: plot.widthFt / 2,
    rotation: 0,
    text,
    fontSize: Math.max(3, Math.min(plot.lengthFt, plot.widthFt) * 0.04),
    color: "#0f172a",
    background: "rgba(255,255,255,0.85)",
    align: "center",
    z: 200,
  };
}

export function newGoalPost(plot: Plot): GoalPostElement {
  return {
    id: newId("goal"),
    type: "goal-post",
    x: plot.lengthFt / 2,
    y: plot.widthFt / 2,
    rotation: 0,
    widthFt: Math.min(21, plot.widthFt * 0.25),
    heightFt: 8,
    depthFt: 6,
    color: "#f0f0f0",
    z: 50,
  };
}

export function newCustomLine(plot: Plot): CustomLineElement {
  return {
    id: newId("line"),
    type: "custom-line",
    x: plot.lengthFt / 2,
    y: plot.widthFt / 2,
    rotation: 0,
    lengthFt: Math.min(20, plot.lengthFt * 0.3),
    thickness: 3,
    color: "#0f172a",
    arrow: "none",
    z: 150,
  };
}

export function newCustomRect(plot: Plot): CustomRectElement {
  return {
    id: newId("rect"),
    type: "custom-rect",
    x: plot.lengthFt / 2,
    y: plot.widthFt / 2,
    rotation: 0,
    width: Math.min(15, plot.lengthFt * 0.2),
    height: Math.min(10, plot.widthFt * 0.2),
    fill: "rgba(15,23,42,0.08)",
    stroke: "#0f172a",
    strokeWidth: 2,
    z: 150,
  };
}

// Highlight zone — coloured underlay for a portion of the court. Sits
// at a low z-index so it draws BEFORE the sport markings and the
// customer sees the tint under the lines. Default colour is a semi-
// transparent yellow (a common "highlight" cue) which sales can
// change immediately via the colour picker.
export function newHighlightZone(plot: Plot): HighlightZoneElement {
  return {
    id: newId("highlight"),
    type: "highlight-zone",
    x: plot.lengthFt / 2,
    y: plot.widthFt / 2,
    rotation: 0,
    width: Math.min(20, plot.lengthFt * 0.25),
    height: Math.min(15, plot.widthFt * 0.25),
    // Amber #FFC107 at 45% — visible on both blue acrylic and green
    // turf without hiding markings on top.
    fill: "rgba(255, 193, 7, 0.45)",
    z: 5,
  };
}

// Named sections of a sport court that sales can highlight in one
// click. Each preset defines a rectangle in COURT-LOCAL coordinates
// (relative to the court element's centre, unrotated) as fractions of
// the court's width (w) and height (h). Consumed by
// highlightZoneFromPreset() which transforms local → world coords
// using the court's own x, y, rotation.
//
// Football + cricket are intentionally not listed per the user's ask.
export type HighlightSectionPreset = {
  key: string; // stable ID stored on the resulting HighlightZoneElement
  label: string; // shown in the inspector button
  // Local rectangle centre + size as fractions of court width/height.
  cxFrac: number; // -0.5..0.5 (court length axis)
  cyFrac: number; // -0.5..0.5 (court width axis)
  wFrac: number;
  hFrac: number;
  // Optional non-rect shape. Same values as HighlightZoneElement.shape
  // — "arc-right" or "arc-left" makes the click overlay AND resulting
  // fill draw as a semi-circle pie slice rather than a rectangle.
  shape?: "rect" | "arc-right" | "arc-left";
};

export const HIGHLIGHT_PRESETS: Record<string, HighlightSectionPreset[]> = {
  "basketball-court": [
    // 3-point area — SEMI-CIRCLE pie slice centred on the basket
    // (5.17 ft from baseline = 0.056 w inward). Radius = 3-point arc
    // distance (~6.75 m from basket = 0.45 of court height in fraction).
    // Sales asked for the highlight to be shaped like the actual arc,
    // not a rectangle overlapping the corners.
    //
    // For left basket: cxFrac = -0.5 + 0.056 = -0.444, arc extends
    // to the +x direction (into court).
    { key: "left-3pt", label: "Left 3-point area (arc)", cxFrac: -0.444, cyFrac: 0, wFrac: 0.24, hFrac: 0.9, shape: "arc-right" },
    { key: "right-3pt", label: "Right 3-point area (arc)", cxFrac: 0.444, cyFrac: 0, wFrac: 0.24, hFrac: 0.9, shape: "arc-left" },
    // Key / paint area — 4.90 m × 4.90 m out from each baseline.
    // keyW = w * 0.175, keyH = h * 0.327.
    // Key centre X = baseline (±w/2) inward by keyW/2 → ±(0.5 − 0.0875) = ±0.4125.
    { key: "left-key", label: "Left key (paint)", cxFrac: -0.4125, cyFrac: 0, wFrac: 0.175, hFrac: 0.327 },
    { key: "right-key", label: "Right key (paint)", cxFrac: 0.4125, cyFrac: 0, wFrac: 0.175, hFrac: 0.327 },
    // Free-throw circle area — 3.60 m diameter (h*0.24) at end of key.
    // Centre X = ±(w/2 − keyW) = ±(0.5 − 0.175) = ±0.325.
    { key: "left-ft", label: "Left free-throw circle", cxFrac: -0.325, cyFrac: 0, wFrac: 0.12, hFrac: 0.24 },
    { key: "right-ft", label: "Right free-throw circle", cxFrac: 0.325, cyFrac: 0, wFrac: 0.12, hFrac: 0.24 },
    // Centre circle — 3.60 m diameter.
    { key: "center-circle", label: "Centre circle", cxFrac: 0, cyFrac: 0, wFrac: 0.12, hFrac: 0.24 },
  ],
  "pickleball-court": [
    // Kitchen / non-volley zone — 7 ft each side of net. kitchenW = w*0.16.
    { key: "kitchen", label: "Kitchen (non-volley)", cxFrac: 0, cyFrac: 0, wFrac: 0.32, hFrac: 1 },
    // Service courts — 4 boxes, one per quadrant.
    { key: "left-top-service", label: "Left service (top)", cxFrac: -0.34, cyFrac: -0.25, wFrac: 0.34, hFrac: 0.5 },
    { key: "left-bot-service", label: "Left service (bottom)", cxFrac: -0.34, cyFrac: 0.25, wFrac: 0.34, hFrac: 0.5 },
    { key: "right-top-service", label: "Right service (top)", cxFrac: 0.34, cyFrac: -0.25, wFrac: 0.34, hFrac: 0.5 },
    { key: "right-bot-service", label: "Right service (bottom)", cxFrac: 0.34, cyFrac: 0.25, wFrac: 0.34, hFrac: 0.5 },
  ],
  // Tennis / badminton / volleyball all use the generic-court renderer.
  // Presets keyed by sport under the generic bucket below.
  "generic-court-tennis": [
    // Service boxes — 2 per side, centred between net + service line
    // (service line ~6.4 m from net = 27% of court length).
    { key: "left-deuce", label: "Left deuce service", cxFrac: -0.135, cyFrac: 0.185, wFrac: 0.27, hFrac: 0.37 },
    { key: "left-ad", label: "Left ad service", cxFrac: -0.135, cyFrac: -0.185, wFrac: 0.27, hFrac: 0.37 },
    { key: "right-deuce", label: "Right deuce service", cxFrac: 0.135, cyFrac: -0.185, wFrac: 0.27, hFrac: 0.37 },
    { key: "right-ad", label: "Right ad service", cxFrac: 0.135, cyFrac: 0.185, wFrac: 0.27, hFrac: 0.37 },
    // Doubles alleys — narrow strips top + bottom.
    { key: "top-alley", label: "Top doubles alley", cxFrac: 0, cyFrac: -0.44, wFrac: 1, hFrac: 0.12 },
    { key: "bot-alley", label: "Bottom doubles alley", cxFrac: 0, cyFrac: 0.44, wFrac: 1, hFrac: 0.12 },
  ],
  "generic-court-badminton": [
    // Regulation 44 × 20: short service line 6.5 ft from net (0.148 w),
    // doubles long service line 2.5 ft from back (0.443 w), singles
    // sideline 1.5 ft in (0.425 h). The four doubles service courts run
    // from the short service line to the long service line, split by the
    // centre line — sized + placed to match the real boxes (the old
    // presets sat over the net and were the wrong size).
    { key: "left-service-right", label: "Left service — right box", cxFrac: -0.296, cyFrac: 0.212, wFrac: 0.295, hFrac: 0.425 },
    { key: "left-service-left", label: "Left service — left box", cxFrac: -0.296, cyFrac: -0.212, wFrac: 0.295, hFrac: 0.425 },
    { key: "right-service-left", label: "Right service — left box", cxFrac: 0.296, cyFrac: -0.212, wFrac: 0.295, hFrac: 0.425 },
    { key: "right-service-right", label: "Right service — right box", cxFrac: 0.296, cyFrac: 0.212, wFrac: 0.295, hFrac: 0.425 },
    // Rear doubles tramlines — the strip between the long service line and
    // the back boundary on each side (where a doubles serve can't land).
    { key: "left-rear-tram", label: "Left rear tramline", cxFrac: -0.4715, cyFrac: 0, wFrac: 0.057, hFrac: 0.85 },
    { key: "right-rear-tram", label: "Right rear tramline", cxFrac: 0.4715, cyFrac: 0, wFrac: 0.057, hFrac: 0.85 },
    // Side doubles alleys — strips outside the singles sidelines, full length.
    { key: "top-alley", label: "Top doubles alley", cxFrac: 0, cyFrac: -0.4625, wFrac: 1, hFrac: 0.075 },
    { key: "bot-alley", label: "Bottom doubles alley", cxFrac: 0, cyFrac: 0.4625, wFrac: 1, hFrac: 0.075 },
  ],
  "generic-court-volleyball": [
    // Attack zone — front 3 m of each half. Court is 18 m long; 3 m = 17%.
    { key: "left-attack", label: "Left attack zone (front)", cxFrac: -0.09, cyFrac: 0, wFrac: 0.17, hFrac: 1 },
    { key: "right-attack", label: "Right attack zone (front)", cxFrac: 0.09, cyFrac: 0, wFrac: 0.17, hFrac: 1 },
    // Back zone.
    { key: "left-back", label: "Left back zone", cxFrac: -0.335, cyFrac: 0, wFrac: 0.33, hFrac: 1 },
    { key: "right-back", label: "Right back zone", cxFrac: 0.335, cyFrac: 0, wFrac: 0.33, hFrac: 1 },
  ],
};

// Build a HighlightZoneElement at the correct WORLD position + size to
// overlay a specific section of the given court element. Applies the
// court's rotation so highlights land correctly on portrait plots too.
export function highlightZoneFromPreset(
  court: {
    x: number;
    y: number;
    rotation: number;
    width: number;
    height: number;
  },
  preset: HighlightSectionPreset,
  fill: string = "rgba(255, 193, 7, 0.45)",
): HighlightZoneElement {
  const localX = preset.cxFrac * court.width;
  const localY = preset.cyFrac * court.height;
  const rot = (court.rotation * Math.PI) / 180;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const worldX = court.x + (localX * cosR - localY * sinR);
  const worldY = court.y + (localX * sinR + localY * cosR);
  return {
    id: newId("highlight"),
    type: "highlight-zone",
    x: worldX,
    y: worldY,
    rotation: court.rotation,
    width: preset.wFrac * court.width,
    height: preset.hFrac * court.height,
    fill,
    preset: preset.key,
    shape: preset.shape ?? "rect",
    z: 5,
  };
}

// "Highlight the run-off area" — a plot-sized zone with the primary
// court cut out, so only the ring around the court (the non-playing
// run-off area) is tinted. Pass the primary court's bounds so we can
// compute the cutout. Without a court it falls back to a plain plot-
// sized rectangle. Captured at creation — if the court is later moved
// or resized, re-add the run-off highlight to refresh the cutout.
export function newRunOffHighlightZone(
  plot: Plot,
  courts?: Array<{ x: number; y: number; width: number; height: number }>,
): HighlightZoneElement {
  const base = {
    id: newId("highlight"),
    type: "highlight-zone" as const,
    x: plot.lengthFt / 2,
    y: plot.widthFt / 2,
    rotation: 0,
    width: plot.lengthFt,
    height: plot.widthFt,
    fill: "rgba(255, 193, 7, 0.35)",
    preset: "run-off",
    z: 6,
  };
  const list = (courts ?? []).filter(Boolean);
  if (list.length === 0) {
    return { ...base, shape: "rect" };
  }
  // Punch out EVERY court so only the run-off around each shows (multi-court).
  const holes = list.map((c) => ({
    cx: c.x - plot.lengthFt / 2,
    cy: c.y - plot.widthFt / 2,
    w: c.width,
    h: c.height,
  }));
  return {
    ...base,
    shape: "ring",
    holes,
    // Back-compat single-hole fields (first court) for any old reader.
    holeCx: holes[0].cx,
    holeCy: holes[0].cy,
    holeW: holes[0].w,
    holeH: holes[0].h,
  };
}

export function newFenceRect(plot: Plot): FenceRectElement {
  return {
    id: newId("fence"),
    type: "fence-rect",
    x: plot.lengthFt / 2,
    y: plot.widthFt / 2,
    rotation: 0,
    width: plot.lengthFt * 0.95,
    height: plot.widthFt * 0.95,
    heightFt: 10,
    color: "#94a3b8",
    hasGate: true,
    gateEdge: "south",
    z: 5,
  };
}

export function newDugout(plot: Plot): DugoutElement {
  return {
    id: newId("dugout"),
    type: "dugout",
    x: plot.lengthFt / 2,
    y: plot.widthFt / 2,
    rotation: 0,
    width: Math.min(12, plot.lengthFt * 0.15),
    height: Math.min(5, plot.widthFt * 0.08),
    openSide: "north",
    roofColor: "#475569",
    benchColor: "#cbd5e1",
    z: 40,
  };
}

export function newBasketballHoop(plot: Plot): BasketballHoopElement {
  return {
    id: newId("hoop"),
    type: "basketball-hoop",
    x: plot.lengthFt / 2,
    y: plot.widthFt / 2,
    rotation: 0,
    poleHeightFt: 10,
    backboardWidthFt: 6,
    color: "#0f172a",
    rimColor: "#ef4444",
    z: 50,
  };
}

// ── P6-01 / P6-02 — facility element factories ───────────────────────
// Placed near an edge/corner by default so they don't land on top of the
// court. All carry sensible sizes derived from the plot; the wizard's
// "Add element" menu (out of this phase's scope) can call these.

// Rotation (deg, clockwise) so a mast placed at (x,y) aims toward the plot
// centre. Beam default (rotation 0) points toward +Y ("north"); this returns
// the clockwise angle from +Y to the centre direction.
function aimRotationToCenter(plot: Plot, x: number, y: number): number {
  const dx = plot.lengthFt / 2 - x;
  const dy = plot.widthFt / 2 - y;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

export function newFloodlight(plot: Plot): FloodlightElement {
  // Drop it just inside the top-right corner, aimed at the field.
  const x = plot.lengthFt * 0.9;
  const y = plot.widthFt * 0.9;
  return {
    id: newId("floodlight"),
    type: "floodlight",
    x,
    y,
    rotation: aimRotationToCenter(plot, x, y),
    poleHeightFt: Math.max(18, Math.min(40, Math.max(plot.lengthFt, plot.widthFt) * 0.18)),
    heads: 4,
    lumens: 60000,
    colorTempK: 5000,
    aimReachFt: Math.max(plot.lengthFt, plot.widthFt) * 0.45,
    z: 60,
  };
}

export function newSeating(plot: Plot): SeatingElement {
  return {
    id: newId("seating"),
    type: "seating",
    x: plot.lengthFt / 2,
    // Along the south edge just outside the run-off.
    y: Math.max(4, plot.widthFt * 0.06),
    rotation: 0,
    width: Math.min(plot.lengthFt * 0.5, 60),
    depth: Math.min(plot.widthFt * 0.12, 12),
    rows: 4,
    color: "#3b82f6",
    z: 45,
  };
}

export function newScoreboard(plot: Plot): ScoreboardElement {
  return {
    id: newId("scoreboard"),
    type: "scoreboard",
    x: plot.lengthFt / 2,
    y: Math.max(3, plot.widthFt * 0.05),
    rotation: 0,
    widthFt: Math.min(16, plot.lengthFt * 0.18),
    heightFt: 10,
    color: "#0f172a",
    z: 48,
  };
}

export function newSightScreen(plot: Plot): SightScreenElement {
  return {
    id: newId("sightscreen"),
    type: "sight-screen",
    x: plot.lengthFt * 0.12,
    y: plot.widthFt / 2,
    rotation: 0,
    widthFt: Math.min(24, plot.lengthFt * 0.2),
    heightFt: 12,
    color: "#f1f5f9",
    z: 44,
  };
}

export function newCornerFlag(plot: Plot): CornerFlagElement {
  return {
    id: newId("cornerflag"),
    type: "corner-flag",
    x: plot.lengthFt * 0.08,
    y: plot.widthFt * 0.08,
    rotation: 0,
    heightFt: 5,
    color: "#ef4444",
    z: 46,
  };
}

export function newGate(plot: Plot): GateElement {
  return {
    id: newId("gate"),
    type: "gate",
    x: plot.lengthFt / 2,
    y: 1,
    rotation: 0,
    widthFt: Math.min(12, plot.lengthFt * 0.14),
    heightFt: 8,
    color: "#94a3b8",
    z: 47,
  };
}

export function newCenterLogo(plot: Plot): CenterLogoElement {
  return {
    id: newId("logo"),
    type: "center-logo",
    x: plot.lengthFt / 2,
    y: plot.widthFt / 2,
    rotation: 0,
    diameterFt: Math.min(plot.lengthFt, plot.widthFt) * 0.16,
    imageUrl: "/quotation-assets/image1.png",
    color: "#ffffff",
    z: 8,
  };
}

// ─────────────────────────────────────────────────────────────────────
//  P5-01 — One-click colour schemes
// ─────────────────────────────────────────────────────────────────────

// A coordinated (surface + line + run-off) palette applied to the whole
// design in one click, so a non-designer lands on a legible, on-brand
// scheme instead of hand-tuning three pickers. Led by the Fitoverse brand
// tokens (#159341 / #73CAF0 / #C81124).
export type ColorScheme = {
  id: string;
  name: string;
  surface: string; // playing-surface / court fill (also grass / pitch)
  line: string; // line markings
  runOff: string; // non-playing run-off ring
};

export const COLOR_SCHEMES: ColorScheme[] = [
  { id: "fitoverse-green", name: "Fitoverse Green", surface: "#159341", line: "#FFFFFF", runOff: "#0C5E29" },
  { id: "cool-blue", name: "Cool Blue", surface: "#1E60A8", line: "#73CAF0", runOff: "#123B66" },
  { id: "bold-red", name: "Bold Red", surface: "#C81124", line: "#FFFFFF", runOff: "#7C0B17" },
  { id: "classic-acrylic", name: "Classic Acrylic", surface: "#265A9A", line: "#FFFFFF", runOff: "#20603A" },
  { id: "terracotta", name: "Terracotta Clay", surface: "#C0563B", line: "#FFFFFF", runOff: "#6E3C2C" },
];

// Recolour every court element + the plot surface/run-off to a scheme.
// Turf sports take the scheme colour on grass / pitch so the whole design
// stays coherent. All other fields (dims, positions, equipment) untouched.
export function applyColorScheme(layout: CourtLayout, scheme: ColorScheme): CourtLayout {
  const elements: Element[] = layout.elements.map((el) => {
    switch (el.type) {
      case "football-field":
        return { ...el, grassColor: scheme.surface, lineColor: scheme.line };
      case "basketball-court":
      case "pickleball-court":
      case "generic-court":
        return { ...el, surfaceColor: scheme.surface, lineColor: scheme.line };
      case "cricket-pitch":
        return { ...el, pitchColor: scheme.surface, markingColor: scheme.line };
      default:
        return el;
    }
  });
  return {
    ...layout,
    elements,
    style: {
      ...layout.style,
      lineColor: scheme.line,
      surfaceColorOverride: scheme.surface,
      runOffColorOverride: scheme.runOff,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
//  P5-04 — Starter-template gallery
// ─────────────────────────────────────────────────────────────────────

// A ready-made "Start from a template" preset. Seeds Step 1 (plot, sports,
// surface, sport config); the wizard builds the layout via buildInitialLayout
// and then applies `extras` (perimeter fence, dugouts, a colour scheme) so the
// design opens as a finished, on-brand facility rather than a bare court.
export type StarterTemplate = {
  id: string;
  name: string;
  blurb: string;
  plot: { lengthFt: number; widthFt: number };
  sports: Sport[];
  surface: SurfaceFinish;
  footballASide?: 5 | 7 | 11;
  basketballHalfCourt?: boolean;
  cricketStripM?: 10 | 20;
  extras?: {
    fence?: boolean;
    dugouts?: boolean;
    schemeId?: string;
    // P6 — full-facility extras: corner floodlight masts, a spectator stand,
    // and a centre-court crest. All optional; only ADD elements.
    floodlights?: boolean;
    seating?: boolean;
    centerLogo?: boolean;
  };
};

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "7aside-turf",
    name: "7-a-side turf arena",
    blurb: "Fenced turf pitch with two team dugouts",
    plot: { lengthFt: 200, widthFt: 140 },
    sports: ["football"],
    surface: "turf_40mm",
    footballASide: 7,
    extras: { fence: true, dugouts: true, floodlights: true, seating: true },
  },
  {
    id: "multisport-tile",
    name: "Multisport tile court",
    blurb: "Basketball + badminton on interlocking PP tile",
    plot: { lengthFt: 100, widthFt: 60 },
    sports: ["basketball", "badminton"],
    surface: "ppe_tile_red",
    basketballHalfCourt: false,
    extras: { fence: true, seating: true },
  },
  {
    id: "3x3-halfcourt",
    name: "3×3 half-court",
    blurb: "Acrylic half-court with a single hoop",
    plot: { lengthFt: 55, widthFt: 40 },
    sports: ["basketball"],
    surface: "acrylic_blue",
    basketballHalfCourt: true,
    extras: { schemeId: "cool-blue" },
  },
  {
    id: "cricket-lane",
    name: "Cricket practice lane",
    blurb: "Fenced turf net lane, 20 m strip",
    plot: { lengthFt: 90, widthFt: 24 },
    sports: ["cricket"],
    surface: "turf_40mm",
    cricketStripM: 20,
    extras: { fence: true },
  },
];

// Layer a template's extras onto an already-built layout (from
// buildInitialLayout). Adds a perimeter fence, flanking dugouts and/or a
// colour scheme. Safe to call on any layout — it only ADDS elements + tweaks
// style, so it never breaks an existing design.
export function applyTemplateExtras(
  layout: CourtLayout,
  template: StarterTemplate,
): CourtLayout {
  const extras = template.extras;
  if (!extras) return layout;
  let out = layout;
  const plot = out.plot;
  const added: Element[] = [];
  if (extras.fence) {
    added.push(newFenceRect(plot));
  }
  if (extras.dugouts) {
    const cx = plot.lengthFt / 2;
    const w = Math.min(18, Math.max(10, plot.lengthFt * 0.16));
    const h = Math.min(6, Math.max(4, plot.widthFt * 0.07));
    const inset = h / 2 + 2;
    // South-edge dugout, opening north toward the pitch.
    added.push({
      ...newDugout(plot),
      id: newId("dugout"),
      x: cx,
      y: inset,
      width: w,
      height: h,
      openSide: "north",
      z: 42,
    });
    // North-edge dugout, opening south toward the pitch.
    added.push({
      ...newDugout(plot),
      id: newId("dugout"),
      x: cx,
      y: plot.widthFt - inset,
      width: w,
      height: h,
      openSide: "south",
      z: 42,
    });
  }
  if (extras.floodlights) {
    // Four corner masts, each aimed at the field centre.
    const insetX = Math.max(4, plot.lengthFt * 0.05);
    const insetY = Math.max(4, plot.widthFt * 0.05);
    const corners: Array<[number, number]> = [
      [insetX, insetY],
      [plot.lengthFt - insetX, insetY],
      [insetX, plot.widthFt - insetY],
      [plot.lengthFt - insetX, plot.widthFt - insetY],
    ];
    for (const [x, y] of corners) {
      added.push({
        ...newFloodlight(plot),
        id: newId("floodlight"),
        x,
        y,
        rotation: aimRotationToCenter(plot, x, y),
      });
    }
  }
  if (extras.seating) {
    // A stand along the south edge (front facing the field / +Y).
    added.push({
      ...newSeating(plot),
      id: newId("seating"),
      x: plot.lengthFt / 2,
      y: Math.max(3, plot.widthFt * 0.045),
      width: Math.min(plot.lengthFt * 0.55, 70),
      depth: Math.min(plot.widthFt * 0.1, 12),
    });
  }
  if (extras.centerLogo) {
    added.push({ ...newCenterLogo(plot), id: newId("logo") });
  }
  if (added.length) out = { ...out, elements: [...out.elements, ...added] };
  if (extras.schemeId) {
    const scheme = COLOR_SCHEMES.find((s) => s.id === extras.schemeId);
    if (scheme) out = applyColorScheme(out, scheme);
  }
  return out;
}
