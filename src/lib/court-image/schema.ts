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
  | BasketballHoopElement;

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
  elements: Element[];
  style: Style;
  // Optional title shown in the canvas header (the layout name the user
  // sees, e.g. "Dr Prabhusankar — 60x100 ft turf"). Persisted alongside
  // customerName on the CourtImage row.
  title?: string;
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
    elements.push({
      id: newId("football"),
      type: "football-field",
      x: cx,
      y: cy,
      rotation: baseRotation,
      width: longFt,
      height: shortFt,
      aSide,
      z: z++,
    });
  }

  if (hasBasketball && !hasFootball) {
    // Solo basketball: fill the plot, using same long-side orientation
    // as football so portrait plots don't squash the court markings.
    const courtW = longFt;
    const courtH = shortFt;
    elements.push({
      id: newId("basketball"),
      type: "basketball-court",
      x: cx,
      y: cy,
      rotation: baseRotation,
      width: courtW,
      height: courtH,
      halfCourt: config.basketball?.halfCourt ?? false,
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
      const offset = (dir * courtW) / 2 - dir * 2;
      elements.push({
        id: newId("hoop"),
        type: "basketball-hoop",
        x: isPortrait ? cx : cx + offset,
        y: isPortrait ? cy + offset : cy,
        rotation: baseRotation + (dir < 0 ? 0 : 180),
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
    // Pickleball is regulation 44 × 20 ft. Always landscape; rotate the
    // whole court on portrait plots so it doesn't get clipped or
    // unexpectedly squished into the short side.
    const w = 44;
    const h = 20;
    elements.push({
      id: newId("pickleball"),
      type: "pickleball-court",
      x: cx,
      y: cy,
      rotation: baseRotation,
      width: Math.min(w, longFt * 0.9),
      height: Math.min(h, shortFt * 0.9),
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
    const w = Math.min(t.width, longFt * 0.9);
    const h = Math.min(t.height, shortFt * 0.9);
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
    elements.push({
      id: newId(`${t.sport}-net`),
      type: "net",
      x: cx,
      y: cy,
      rotation: baseRotation,
      widthFt: w,
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

  return {
    v: 1,
    plot,
    sports,
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
