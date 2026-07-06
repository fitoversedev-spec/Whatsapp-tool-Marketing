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
  // diameter along Y and arc extending +X. "arc-left" = mirror. Used
  // by presets like basketball 3-point area where a rectangle
  // extends beyond the actual arc.
  shape?: "rect" | "arc-right" | "arc-left";
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
  | HighlightZoneElement;

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

// URL served by Next.js from /public for surfaces that render with a
// photograph in the sample callout. Acrylic surfaces have no image
// (solid colour). Drop /images/tiles/pvc-sports.jpg into public/ when
// the PVC sample photo is provided and it'll show automatically.
export const SURFACE_IMAGE_URL: Partial<Record<SurfaceFinish, string>> = {
  ppe_tile_red: "/images/tiles/red-ppe-tile.jpg",
  pvc_sports: "/images/tiles/pvc-sports.jpg",
};

// Turf finishes are laid as alternating light + dark rolls (mowed
// stripe effect). Each finish has TWO photographs — one per shade —
// shown together in the callout so the customer sees exactly which
// two tones will be used.
export const TURF_IMAGE_URLS: Partial<Record<SurfaceFinish, { light: string; dark: string }>> = {
  turf_40mm: {
    light: "/images/tiles/40 mm light green.jpg",
    dark: "/images/tiles/40 mm dark green.jpg",
  },
  turf_50mm: {
    light: "/images/tiles/50mm light green.webp",
    dark: "/images/tiles/50 mm dark green1.webp",
  },
};

// Solid fill colour for surfaces that don't use a photograph — the
// PlotSurface renderer paints the plot with this and the sample-tile
// callout is skipped (acrylic is a coating, not tiles).
export const SURFACE_SOLID_COLOR: Partial<Record<SurfaceFinish, string>> = {
  acrylic_blue: "#265a9a",
  acrylic_green: "#2f6d3a",
  turf_40mm: "#2f8c3e",
  turf_50mm: "#2f8c3e",
  // Green — matches the PVC sports-floor sample photograph so the
  // solid fallback colour stays coherent with the callout swatch even
  // if the image fails to load.
  pvc_sports: "#3ea867",
};

// Base stripe tones for turf. Rendered as alternating parallel stripes
// across the field length, mimicking a real mowed pattern.
export const TURF_STRIPE_COLORS: Partial<Record<SurfaceFinish, { light: string; dark: string }>> = {
  turf_40mm: { light: "#3fa050", dark: "#256c30" },
  turf_50mm: { light: "#3fa050", dark: "#256c30" },
};

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
  "sand" | "concrete" | "grass",
  string
> = {
  sand: "#9c845b",
  concrete: "#94A3B8",
  grass: "#5C7C3D",
};

export function resolveGroundColor(
  finish: "sand" | "concrete" | "grass" | undefined,
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
  groundFinish?: "sand" | "concrete" | "grass";
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
  // Optional watermark (logo URL + opacity).
  watermarkUrl?: string;
  watermarkOpacity?: number;
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
  // Optional title shown in the canvas header (the layout name the user
  // sees, e.g. "Dr Prabhusankar — 60x100 ft turf"). Persisted alongside
  // customerName on the CourtImage row.
  title?: string;
};

// Distinct fill colour per sport for multi-sport plots. Matches the TSS
// reference photo the user shared: basketball blue, volleyball / pickleball
// grey, football / cricket green, tennis green, badminton sand. When a
// layout has 2+ sports, buildInitialLayout applies these as each element's
// surfaceColor so sales sees the colour-coded zones the customer will get.
// Single-sport designs skip this so their existing look is unchanged.
export const MULTISPORT_ZONE_COLOR: Record<Sport, string> = {
  basketball: "#1E60A8",
  volleyball: "#7A8894",
  pickleball: "#8892A0",
  tennis: "#3D7A47",
  badminton: "#C4A66A",
  football: "#3E8A47",
  cricket: "#3E8A47",
  multisport: "#6B7280",
};

// ─────────────────────────────────────────────────────────────────────
//  Defaults + initial layout generator
// ─────────────────────────────────────────────────────────────────────

// A-side proportional configs — football fields scale their markings off
// these so the same renderer covers 5/7/11-a-side turfs without per-side
// code paths. All values are *fractions of field width/height*.
const A_SIDE_PROPS = {
  5: {
    penaltyBoxWidthRatio: 0.16, // along x (length)
    penaltyBoxHeightRatio: 0.55, // along y (width)
    goalAreaWidthRatio: 0.07,
    goalAreaHeightRatio: 0.25,
    centerCircleRadiusRatio: 0.12,
    goalWidthRatio: 0.17,
  },
  7: {
    penaltyBoxWidthRatio: 0.18,
    penaltyBoxHeightRatio: 0.6,
    goalAreaWidthRatio: 0.075,
    goalAreaHeightRatio: 0.3,
    centerCircleRadiusRatio: 0.14,
    goalWidthRatio: 0.18,
  },
  11: {
    penaltyBoxWidthRatio: 0.165,
    penaltyBoxHeightRatio: 0.66,
    goalAreaWidthRatio: 0.055,
    goalAreaHeightRatio: 0.36,
    centerCircleRadiusRatio: 0.15,
    goalWidthRatio: 0.12,
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
// used Math.min(regulation, plot - margin), which capped the court at
// regulation size — so a customer's 113 × 67 ft plot got the full-court
// FIBA rectangle (91.86 × 49.21) centred with a lot of empty run-off.
// Sales asked for the court to actually fill their entered dimensions
// while still looking proportional.
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
    const playSizes: Record<5 | 7 | 11, { l: number; w: number }> = {
      5: { l: 131, w: 66 },
      7: { l: 197, w: 131 },
      11: { l: 344, w: 223 },
    };
    const ps = playSizes[aSide];
    // Scale the FIFA playing area to fit the entered plot so the pitch
    // actually reflects the customer's dimensions instead of getting
    // clamped at the regulation size (which left huge empty run-off on
    // custom plots).
    const { courtW: pitchL, courtH: pitchW } = fitCourtToPlot(
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
    const { courtW, courtH } = fitCourtToPlot(
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
    const { courtW, courtH } = fitCourtToPlot(44, 20, longFt, shortFt);
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
    netTargets.push({ sport: "tennis", width: 78, height: 36, netHeightFt: 3.5 });
  }
  if (sports.includes("badminton")) {
    netTargets.push({ sport: "badminton", width: 44, height: 20, netHeightFt: 5 });
  }
  if (sports.includes("volleyball")) {
    netTargets.push({ sport: "volleyball", width: 59, height: 30, netHeightFt: 7.9 });
  }
  for (const t of netTargets) {
    // Fill the plot preserving the sport's regulation aspect ratio so
    // custom-size plots don't get a tiny regulation court centred with
    // dead space around it.
    const { courtW: w, courtH: h } = fitCourtToPlot(
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
      if ("surfaceColor" in el && el.surfaceColor) continue;
      const s = sportForType(el.type, "sport" in el ? el.sport : undefined);
      if (!s) continue;
      const palette = MULTISPORT_ZONE_COLOR[s];
      if (palette && "surfaceColor" in el) {
        (el as { surfaceColor?: string }).surfaceColor = palette;
      }
    }

    // Auto-layout — primary sport stays at plot centre (already sized to
    // fill via the sport branches above). Secondary sports get inset
    // positions + regulation dimensions so they don't stack at the
    // centre. Matches the TSS "one court for every sport" reference
    // photo where basketball is dominant and pickleball / volleyball
    // sit as smaller zones inside the basketball court.
    //
    // Regulation playing-area dimensions used as the inset size for
    // secondary sports:
    const INSET_SIZE: Partial<Record<Sport, { w: number; h: number }>> = {
      basketball: { w: 49.21, h: 36.09 }, // FIBA half court
      pickleball: { w: 44, h: 20 },
      tennis: { w: 78, h: 36 },
      badminton: { w: 44, h: 20 },
      volleyball: { w: 59, h: 30 },
    };
    // Slot positions relative to plot centre, ordered so the first
    // secondary lands on the LEFT half, second on the RIGHT half, and
    // additional secondaries stack above / below. Fractions of plot L/W.
    const SLOTS: Array<{ dx: number; dy: number }> = [
      { dx: -0.22, dy: 0 },
      { dx: 0.22, dy: 0 },
      { dx: 0, dy: -0.28 },
      { dx: 0, dy: 0.28 },
    ];
    const primarySportIndex = 0;
    let slotIndex = 0;
    // First pass: find element positions per sport so we can update them.
    for (let i = 0; i < sports.length; i++) {
      if (i === primarySportIndex) continue; // primary keeps its size + centre
      const sport = sports[i];
      const el = elements.find(
        (e) => sportForType(e.type, "sport" in e ? e.sport : undefined) === sport,
      );
      if (!el) continue;
      const inset = INSET_SIZE[sport];
      if (!inset) continue;
      // Cap the inset at 55% of the plot so it doesn't overrun the
      // primary court on small plots.
      const w = Math.min(inset.w, longFt * 0.55);
      const h = Math.min(inset.h, shortFt * 0.55);
      const slot = SLOTS[slotIndex % SLOTS.length];
      slotIndex += 1;
      const targetX = plot.lengthFt / 2 + slot.dx * plot.lengthFt;
      const targetY = plot.widthFt / 2 + slot.dy * plot.widthFt;
      if ("x" in el) el.x = targetX;
      if ("y" in el) el.y = targetY;
      if ("width" in el) (el as { width?: number }).width = w;
      if ("height" in el) (el as { height?: number }).height = h;
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
    { key: "left-right-service", label: "Left right service", cxFrac: -0.185, cyFrac: 0.185, wFrac: 0.37, hFrac: 0.37 },
    { key: "left-left-service", label: "Left left service", cxFrac: -0.185, cyFrac: -0.185, wFrac: 0.37, hFrac: 0.37 },
    { key: "right-right-service", label: "Right right service", cxFrac: 0.185, cyFrac: -0.185, wFrac: 0.37, hFrac: 0.37 },
    { key: "right-left-service", label: "Right left service", cxFrac: 0.185, cyFrac: 0.185, wFrac: 0.37, hFrac: 0.37 },
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

// "Highlight the run-off area" — a zone the size of the whole plot
// centred at plot centre. Sits at a low z-index (below courts), so
// visually it shows only the ring around the primary court and
// under the surface / grid overlay. Sales gets one-click filling of
// the non-playing area without needing to drag a rectangle.
export function newRunOffHighlightZone(plot: Plot): HighlightZoneElement {
  return {
    id: newId("highlight"),
    type: "highlight-zone",
    x: plot.lengthFt / 2,
    y: plot.widthFt / 2,
    rotation: 0,
    width: plot.lengthFt,
    height: plot.widthFt,
    fill: "rgba(255, 193, 7, 0.35)",
    preset: "run-off",
    shape: "rect",
    // z: 4 so it sits below the primary sport court (which is z: 5+
    // via newId's counter) — the court covers the middle, highlight
    // fills only the run-off ring visually.
    z: 4,
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
