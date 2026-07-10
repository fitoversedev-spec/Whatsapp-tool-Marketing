// Turf shape library — the curved / cricket-first shapes from the
// "Turf Shape Possibilities" catalogue + Shape Reasoning Module specs.
//
// Every shape is generated as a DENSE POLYGON (points in plot feet, x along
// the length 0..L, y along the width 0..W, origin bottom-left — the same
// convention as buildPlotPolygon / layout.plot.polygon). Curves are sampled
// finely enough to read as smooth at screen + PDF resolution, so the existing
// polygon renderer / clip / export need no changes.
//
// The LONG axis (L) is always the cricket pitch axis (spec rule: give the
// longest boundary where the ball is hit hardest), so cricket-first shapes
// (Cricket-D, teardrop, asymmetric oval) bulge/curve along L.

export type Pt = { x: number; y: number };

export type TurfShapeKind =
  | "rectangle"
  | "rounded-rect"
  | "oval"
  | "circle"
  | "stadium"
  | "squircle"
  | "octagon"
  | "hexagon"
  | "asymmetric-oval"
  | "teardrop"
  | "cricket-d"
  | "kidney";

export type TurfShapeMeta = {
  kind: TurfShapeKind;
  label: string;
  /** Indicative area utilisation for a square-ish plot (recompute per plot). */
  utilPct: number;
  blurb: string;
  /** True = a cricket-first / cricket-friendly boundary shape. */
  cricketFirst: boolean;
};

// Order + copy mirror the catalogue SVG the customer shared.
export const TURF_SHAPES: TurfShapeMeta[] = [
  { kind: "rectangle", label: "Rectangle", utilPct: 100, blurb: "Max area · football-first", cricketFirst: false },
  { kind: "rounded-rect", label: "Rounded rectangle", utilPct: 95, blurb: "Best all-rounder · safe corners", cricketFirst: false },
  { kind: "octagon", label: "Chamfered / Octagon", utilPct: 88, blurb: "Even boundary · low cost", cricketFirst: false },
  { kind: "circle", label: "Circle", utilPct: 73, blurb: "Cricket showpiece", cricketFirst: true },
  { kind: "oval", label: "Oval / Ellipse", utilPct: 79, blurb: "Authentic cricket ground", cricketFirst: true },
  { kind: "stadium", label: "Stadium", utilPct: 82, blurb: "Straight sides · round ends", cricketFirst: true },
  { kind: "squircle", label: "Squircle", utilPct: 90, blurb: "Premium curve · square plots", cricketFirst: false },
  { kind: "asymmetric-oval", label: "Asymmetric oval", utilPct: 76, blurb: "Leg-side / straight boundary", cricketFirst: true },
  { kind: "teardrop", label: "Teardrop", utilPct: 74, blurb: "Deep batting-end boundary", cricketFirst: true },
  { kind: "cricket-d", label: "Cricket-D", utilPct: 88, blurb: "Flat goal end + curved deep field", cricketFirst: true },
  { kind: "hexagon", label: "Hexagon / Lozenge", utilPct: 85, blurb: "Signature look", cricketFirst: false },
  { kind: "kidney", label: "Kidney", utilPct: 70, blurb: "Curves around a tree / pole", cricketFirst: false },
];

export function turfShapeMeta(kind: TurfShapeKind): TurfShapeMeta {
  return TURF_SHAPES.find((s) => s.kind === kind) ?? TURF_SHAPES[0];
}

const TAU = Math.PI * 2;

// Shoelace area of a closed polygon (plot feet → sq ft). Sign-independent.
export function polygonAreaSqFt(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

// Perimeter of a closed polygon (feet) — drives net/pole cost for a box build.
export function polygonPerimeterFt(poly: Pt[]): number {
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

// Sample an elliptical arc (t = angle, standard math orientation).
function ellipseArc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  t0: number,
  t1: number,
  n: number,
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return out;
}

// Options for the shapes that take a parameter (all optional; sensible
// defaults match the catalogue).
export type TurfShapeOpts = {
  /** Corner radius as a fraction of min(L,W) — rounded-rect. */
  cornerPct?: number;
  /** Notch position along the boundary in degrees (0 = right, 90 = top) — kidney. */
  notchAngleDeg?: number;
};

// Build a shape polygon inscribed in an L × W box, centred. Returns undefined
// for a plain rectangle (renderer draws a rectangle in that case).
export function buildTurfShapePolygon(
  lengthFt: number,
  widthFt: number,
  kind: TurfShapeKind,
  opts: TurfShapeOpts = {},
): Pt[] | undefined {
  const L = lengthFt;
  const W = widthFt;
  const cx = L / 2;
  const cy = W / 2;
  const short = Math.min(L, W);

  switch (kind) {
    case "rectangle":
      return undefined;

    case "oval":
      return ellipseArc(cx, cy, L / 2, W / 2, 0, TAU, 96).slice(0, -1);

    case "circle": {
      const r = short / 2;
      return ellipseArc(cx, cy, r, r, 0, TAU, 96).slice(0, -1);
    }

    case "squircle": {
      // Superellipse |x/a|^n + |y/b|^n = 1, n = 4.
      const a = L / 2;
      const b = W / 2;
      const n = 4;
      const out: Pt[] = [];
      const steps = 120;
      for (let i = 0; i < steps; i++) {
        const t = (TAU * i) / steps;
        const ct = Math.cos(t);
        const st = Math.sin(t);
        const x = cx + a * Math.sign(ct) * Math.pow(Math.abs(ct), 2 / n);
        const y = cy + b * Math.sign(st) * Math.pow(Math.abs(st), 2 / n);
        out.push({ x, y });
      }
      return out;
    }

    case "rounded-rect": {
      const r = Math.min(short * (opts.cornerPct ?? 0.2), short / 2 - 0.5);
      const seg = 10;
      return [
        ...ellipseArc(L - r, r, r, r, -Math.PI / 2, 0, seg), // BR
        ...ellipseArc(L - r, W - r, r, r, 0, Math.PI / 2, seg), // TR
        ...ellipseArc(r, W - r, r, r, Math.PI / 2, Math.PI, seg), // TL
        ...ellipseArc(r, r, r, r, Math.PI, (3 * Math.PI) / 2, seg), // BL
      ];
    }

    case "stadium": {
      // Straight long sides + semicircular short ends (radius = half the
      // short side). Orient the round ends on the LONG axis.
      if (L >= W) {
        const r = W / 2;
        return [
          ...ellipseArc(L - r, cy, r, r, -Math.PI / 2, Math.PI / 2, 24), // right end
          ...ellipseArc(r, cy, r, r, Math.PI / 2, (3 * Math.PI) / 2, 24), // left end
        ];
      }
      const r = L / 2;
      return [
        ...ellipseArc(cx, W - r, r, r, 0, Math.PI, 24), // top end
        ...ellipseArc(cx, r, r, r, Math.PI, TAU, 24), // bottom end
      ];
    }

    case "octagon": {
      const c = short * 0.28;
      return [
        { x: c, y: 0 },
        { x: L - c, y: 0 },
        { x: L, y: c },
        { x: L, y: W - c },
        { x: L - c, y: W },
        { x: c, y: W },
        { x: 0, y: W - c },
        { x: 0, y: c },
      ];
    }

    case "hexagon": {
      // Elongated hexagon: apex on each SHORT end of the long axis.
      const cutX = L * 0.15;
      return [
        { x: cutX, y: 0 },
        { x: L - cutX, y: 0 },
        { x: L, y: cy },
        { x: L - cutX, y: W },
        { x: cutX, y: W },
        { x: 0, y: cy },
      ];
    }

    case "asymmetric-oval": {
      // Egg — bulged on the +x (leg-side / straight) end of the pitch axis.
      // Centre shifted to 0.41·L so the egg still spans the full length.
      const e = 0.18;
      const rx = L / 2;
      const ecx = 0.41 * L;
      const ry = W / 2;
      const out: Pt[] = [];
      const steps = 96;
      for (let i = 0; i < steps; i++) {
        const t = (TAU * i) / steps;
        const ct = Math.cos(t);
        out.push({ x: ecx + rx * ct * (1 + e * ct), y: cy + ry * Math.sin(t) });
      }
      return out;
    }

    case "teardrop": {
      // Classic teardrop curve — round bulb at the left (batting end), point at
      // the right. m controls fatness; y normalised so it fills the width.
      const m = 1.05;
      const steps = 96;
      const raw: Array<{ bx: number; by: number }> = [];
      let maxBy = 0;
      for (let i = 0; i < steps; i++) {
        const t = (TAU * i) / steps;
        const bx = Math.cos(t);
        const by = Math.sin(t) * Math.pow(Math.sin(t / 2), m);
        raw.push({ bx, by });
        maxBy = Math.max(maxBy, Math.abs(by));
      }
      return raw.map(({ bx, by }) => ({
        x: cx + bx * (L / 2),
        y: cy + (by / maxBy) * (W / 2),
      }));
    }

    case "cricket-d": {
      // Flat end at the left (football goal), semicircular deep field at the
      // right (cricket). The bulge's y-radius is W/2 (full width); its x-depth
      // is clamped so the arc NEVER extends past L — on a portrait plot (L <
      // W/2) it degrades to a shallow half-ellipse instead of spilling out of
      // the plot box (which used to over-report the turf area 2-3x).
      const r = W / 2;
      const flatX = Math.max(0, L - r);
      const rx = Math.min(r, L - flatX); // x-depth, bounded to the plot length
      return [
        { x: 0, y: 0 },
        { x: flatX, y: 0 },
        ...ellipseArc(flatX, cy, rx, r, -Math.PI / 2, Math.PI / 2, 32),
        { x: flatX, y: W },
        { x: 0, y: W },
      ];
    }

    case "kidney": {
      // Oval with an inward pinch (obstacle notch). notchAngleDeg picks where
      // the dent sits (default top-centre).
      const rx = L / 2;
      const ry = W / 2;
      const notch = ((opts.notchAngleDeg ?? 90) * Math.PI) / 180;
      const depth = 0.45;
      const spread = 0.5; // radians
      const out: Pt[] = [];
      const steps = 120;
      for (let i = 0; i < steps; i++) {
        const t = (TAU * i) / steps;
        const bx = cx + rx * Math.cos(t);
        const by = cy + ry * Math.sin(t);
        // Angular distance to the notch centre, wrapped to [-π, π].
        let d = t - notch;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        const pull = depth * Math.exp(-(d * d) / (2 * spread * spread));
        out.push({ x: cx + (bx - cx) * (1 - pull), y: cy + (by - cy) * (1 - pull) });
      }
      return out;
    }
  }
}

// Where to draw the obstacle marker for a kidney (plot feet), so the UI/render
// can show the tree/pole it curves around. Null for non-kidney shapes.
export function kidneyObstacle(
  lengthFt: number,
  widthFt: number,
  opts: TurfShapeOpts = {},
): Pt | null {
  const notch = ((opts.notchAngleDeg ?? 90) * Math.PI) / 180;
  return {
    x: lengthFt / 2 + (lengthFt / 2) * Math.cos(notch) * 0.72,
    y: widthFt / 2 + (widthFt / 2) * Math.sin(notch) * 0.72,
  };
}
