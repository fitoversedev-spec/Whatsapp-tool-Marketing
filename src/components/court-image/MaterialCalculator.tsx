"use client";

// Explicit, PERSISTED flooring material calculator for the court designer's
// "Flooring options" panel. Unlike the old always-on version, this behaves like
// a standalone calculator:
//   1. pick a FLOORING TYPE (turf / PVC / PP tile / acrylic),
//   2. enter the plot size (ft) and that flooring's roll/tile sizes,
//   3. press CALCULATE to get rolls/tiles-needed, area and running length.
//
// The flooring type DEFAULTS to the design's active `surface` (mapped via the
// schema surface helpers). Roll/tile sizes + wastage % are the GLOBAL company
// standards loaded from /api/court-images/material-sizes on mount and persisted
// back (debounced) so they're reused next session; the plot size is a per-run
// value that defaults from the design plot but is freely editable.
//
// The result is a SNAPSHOT — it is (re)computed only on mount (defaults), when
// the saved standards load, when the flooring type changes, and when Calculate
// is pressed. It never recomputes live while the user is typing a size.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ppeTileCount,
  turfRollMeters,
  pvcRollCount,
  acrylicLitres,
  withWastage,
  isTiledSurface,
  isTurfSurface,
  isPvcSurface,
  isAcrylicSurface,
  type SurfaceFinish,
} from "@/lib/court-image/schema";
import type { MaterialSizes } from "@/lib/court-image/material-config";

// Mirror of DEFAULT_MATERIAL_SIZES (kept local so this client component never
// imports the prisma-backed material-config module at runtime — only its type).
const DEFAULTS: MaterialSizes = {
  turfRollWidthM: 2,
  turfRollLengthM: 25,
  pvcRollWidthM: 1.8,
  pvcRollLengthM: 20,
  ppTileCm: 30,
  ppTileThicknessMm: 0,
  wastagePct: 10,
};

const FIELDS: (keyof MaterialSizes)[] = [
  "turfRollWidthM",
  "turfRollLengthM",
  "pvcRollWidthM",
  "pvcRollLengthM",
  "ppTileCm",
  "ppTileThicknessMm",
  "wastagePct",
];

// Divisor fields must be > 0; thickness + wastage may be 0.
const POSITIVE_ONLY = new Set<keyof MaterialSizes>([
  "turfRollWidthM",
  "turfRollLengthM",
  "pvcRollWidthM",
  "pvcRollLengthM",
  "ppTileCm",
]);

const FT_PER_M = 3.281;
const CM_PER_FT = 30.48;

// The four flooring families that have material math.
type FlooringType = "turf" | "pvc" | "tile" | "acrylic";

const TYPES: { key: FlooringType; label: string }[] = [
  { key: "turf", label: "Turf" },
  { key: "pvc", label: "PVC roll" },
  { key: "tile", label: "PP tile" },
  { key: "acrylic", label: "Acrylic" },
];

// Map the design's active surface → the calculator's default flooring type.
function typeFromSurface(surface: SurfaceFinish): FlooringType {
  if (isTiledSurface(surface)) return "tile";
  if (isTurfSurface(surface)) return "turf";
  if (isPvcSurface(surface)) return "pvc";
  if (isAcrylicSurface(surface)) return "acrylic";
  return "turf";
}

function parseField(key: keyof MaterialSizes, raw: string): number {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULTS[key];
  if (POSITIVE_ONLY.has(key) && n <= 0) return DEFAULTS[key];
  return n;
}

// Plot dimensions must be a positive finite number, else the prop default.
function parsePlot(raw: string, fallback: number): number {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function draftFrom(sizes: MaterialSizes): Record<keyof MaterialSizes, string> {
  return {
    turfRollWidthM: String(sizes.turfRollWidthM),
    turfRollLengthM: String(sizes.turfRollLengthM),
    pvcRollWidthM: String(sizes.pvcRollWidthM),
    pvcRollLengthM: String(sizes.pvcRollLengthM),
    ppTileCm: String(sizes.ppTileCm),
    ppTileThicknessMm: String(sizes.ppTileThicknessMm),
    wastagePct: String(sizes.wastagePct),
  };
}

const nf = (n: number) => n.toLocaleString("en-IN");

// Pure result renderer — a SNAPSHOT for the given flooring type, sizes + plot.
function buildResult(
  type: FlooringType,
  s: MaterialSizes,
  L: number,
  W: number,
): ReactNode {
  const areaSqFt = Math.round(L * W);
  const areaSqM = Math.round((L / FT_PER_M) * (W / FT_PER_M));

  if (type === "tile") {
    const tileFt = s.ppTileCm / CM_PER_FT;
    const c = ppeTileCount(L, W, tileFt);
    const needed = withWastage(c.total, s.wastagePct);
    return (
      <>
        <div className="font-medium">
          {nf(needed)} tiles needed
          <span className="font-normal text-slate-500">
            {" "}
            (incl. {s.wastagePct}% wastage)
          </span>
        </div>
        <div className="text-slate-500">
          {nf(c.total)} exact · {c.perLength} × {c.perWidth} at {s.ppTileCm} ×{" "}
          {s.ppTileCm} cm
          {s.ppTileThicknessMm > 0 ? ` · ${s.ppTileThicknessMm} mm thick` : ""}
        </div>
        <div className="text-slate-500">
          Total area {nf(areaSqM)} m² ({nf(areaSqFt)} sq.ft)
        </div>
      </>
    );
  }

  if (type === "turf") {
    const r = turfRollMeters(L, W, {
      rollWidthM: s.turfRollWidthM,
      rollLengthM: s.turfRollLengthM,
    });
    const baseRolls = r.lightRolls + r.darkRolls;
    const needed = withWastage(baseRolls, s.wastagePct);
    return (
      <>
        <div className="font-medium">
          {nf(needed)} rolls needed
          <span className="font-normal text-slate-500">
            {" "}
            (incl. {s.wastagePct}% wastage)
          </span>
        </div>
        <div className="text-slate-500">
          {baseRolls} exact · Light {r.lightRolls} + Dark {r.darkRolls} ·{" "}
          {s.turfRollWidthM} × {s.turfRollLengthM} m rolls
        </div>
        <div className="text-slate-500">
          Running length {nf(r.totalMeters)} m · {r.stripes} stripes · total area{" "}
          {nf(areaSqM)} m² ({nf(areaSqFt)} sq.ft)
        </div>
      </>
    );
  }

  if (type === "pvc") {
    const p = pvcRollCount(L, W, {
      rollWidthM: s.pvcRollWidthM,
      rollLengthM: s.pvcRollLengthM,
    });
    const needed = withWastage(p.rolls, s.wastagePct);
    return (
      <>
        <div className="font-medium">
          {nf(needed)} rolls needed
          <span className="font-normal text-slate-500">
            {" "}
            (incl. {s.wastagePct}% wastage)
          </span>
        </div>
        <div className="text-slate-500">
          {p.rolls} exact · {s.pvcRollWidthM} m wide × {s.pvcRollLengthM} m long
        </div>
        <div className="text-slate-500">
          Total area {nf(p.totalSqM)} m² ({nf(areaSqFt)} sq.ft) · running length{" "}
          {nf(p.runningMeters)} m
        </div>
      </>
    );
  }

  // Acrylic — coated by area, no rolls or tiles.
  const lit = acrylicLitres(areaSqFt);
  return (
    <>
      <div className="font-medium">
        {nf(areaSqM)} m² to coat
        <span className="font-normal text-slate-500">
          {" "}
          ({nf(areaSqFt)} sq.ft)
        </span>
      </div>
      <div className="text-slate-500">
        ~{nf(lit.total)} L acrylic · primer {nf(lit.primer)} + resurfacer{" "}
        {nf(lit.resurfacer)} + colour {nf(lit.color)} L
      </div>
      <div className="text-slate-500">Area-based coating · no rolls or tiles</div>
    </>
  );
}

export default function MaterialCalculator({
  plotLengthFt,
  plotWidthFt,
  surface,
}: {
  plotLengthFt: number;
  plotWidthFt: number;
  surface: SurfaceFinish;
}) {
  const initialType = typeFromSurface(surface);

  const [floorType, setFloorType] = useState<FlooringType>(initialType);
  const [draft, setDraft] = useState<Record<keyof MaterialSizes, string>>(() =>
    draftFrom(DEFAULTS),
  );
  // Plot size — defaults from the design plot but freely editable per run.
  const [plotDraft, setPlotDraft] = useState<{ length: string; width: string }>(
    () => ({ length: String(plotLengthFt), width: String(plotWidthFt) }),
  );
  // Result snapshot — seeded from the defaults so the panel is never empty.
  const [result, setResult] = useState<ReactNode>(() =>
    buildResult(initialType, DEFAULTS, plotLengthFt, plotWidthFt),
  );

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only persist after the user actually edits a field — so loading the saved
  // sizes on mount doesn't immediately echo them back with a redundant POST.
  const dirty = useRef(false);

  // Committed numeric sizes derived from the input drafts (invalid → default).
  const sizes: MaterialSizes = useMemo(() => {
    const out = {} as MaterialSizes;
    for (const k of FIELDS) out[k] = parseField(k, draft[k]);
    return out;
  }, [draft]);

  // Load the saved standard sizes once on mount, then refresh the result so it
  // reflects the persisted standards without needing a click.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/court-images/material-sizes")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.sizes) return;
        const loaded = j.sizes as MaterialSizes;
        setDraft(draftFrom(loaded));
        // plotDraft is still the mount default (props) here — user hasn't typed.
        setResult(
          buildResult(
            initialType,
            loaded,
            parsePlot(String(plotLengthFt), plotLengthFt),
            parsePlot(String(plotWidthFt), plotWidthFt),
          ),
        );
      })
      .catch(() => {
        /* keep defaults on failure */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist (debounced) whenever the parsed sizes change from a user edit.
  useEffect(() => {
    if (!dirty.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/court-images/material-sizes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sizes),
      }).catch(() => {
        /* transient save failure — the local edit still applies live */
      });
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [sizes]);

  // ── Current plot (parsed) ──
  const currentPlot = (): { L: number; W: number } => ({
    L: parsePlot(plotDraft.length, plotLengthFt),
    W: parsePlot(plotDraft.width, plotWidthFt),
  });

  // Recompute the snapshot for an explicit type + sizes. Called only from
  // discrete actions (type change / Calculate) — never on a keystroke.
  function recalc(type: FlooringType, s: MaterialSizes) {
    const { L, W } = currentPlot();
    setResult(buildResult(type, s, L, W));
  }

  // ── Size / wastage edit handlers (do NOT recompute the result live) ──
  function onEdit(key: keyof MaterialSizes, value: string) {
    dirty.current = true;
    setDraft((d) => ({ ...d, [key]: value }));
  }
  function onBlur(key: keyof MaterialSizes) {
    setDraft((d) => ({ ...d, [key]: String(sizes[key]) }));
  }

  // ── Plot edit handlers (do NOT recompute the result live) ──
  function onPlotEdit(key: "length" | "width", value: string) {
    setPlotDraft((p) => ({ ...p, [key]: value }));
  }
  function onPlotBlur(key: "length" | "width") {
    const fallback = key === "length" ? plotLengthFt : plotWidthFt;
    setPlotDraft((p) => ({ ...p, [key]: String(parsePlot(p[key], fallback)) }));
  }

  function selectType(type: FlooringType) {
    if (type === floorType) return;
    setFloorType(type);
    recalc(type, sizes);
  }

  const numInput = (key: keyof MaterialSizes, label: string, step: number) => (
    <label className="block">
      <span className="text-[10px] text-slate-500 uppercase tracking-wide">
        {label}
      </span>
      <input
        type="number"
        min={0}
        step={step}
        value={draft[key]}
        onChange={(e) => onEdit(key, e.target.value)}
        onBlur={() => onBlur(key)}
        className="input mt-1 text-sm py-1"
      />
    </label>
  );

  const plotInput = (key: "length" | "width", label: string) => (
    <label className="block">
      <span className="text-[10px] text-slate-500 uppercase tracking-wide">
        {label}
      </span>
      <input
        type="number"
        min={0}
        step={1}
        value={plotDraft[key]}
        onChange={(e) => onPlotEdit(key, e.target.value)}
        onBlur={() => onPlotBlur(key)}
        className="input mt-1 text-sm py-1"
      />
    </label>
  );

  return (
    <div className="space-y-2">
      {/* 1 — Flooring type selector */}
      <div>
        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
          Flooring type
        </div>
        <div className="flex flex-wrap gap-1">
          {TYPES.map((t) => {
            const active = t.key === floorType;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => selectType(t.key)}
                aria-pressed={active}
                className={
                  "text-[11px] font-medium px-2 py-1 rounded-md border transition " +
                  (active
                    ? "bg-court-500 text-white border-court-500"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")
                }
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2 — Plot size (editable, defaults from the design) */}
      <div className="grid grid-cols-2 gap-2">
        {plotInput("length", "Plot length (ft)")}
        {plotInput("width", "Plot width (ft)")}
      </div>

      {/* 3 — Flooring-specific size inputs */}
      {floorType === "turf" && (
        <div className="grid grid-cols-2 gap-2">
          {numInput("turfRollWidthM", "Roll width (m)", 0.1)}
          {numInput("turfRollLengthM", "Roll length (m)", 1)}
        </div>
      )}
      {floorType === "pvc" && (
        <div className="grid grid-cols-2 gap-2">
          {numInput("pvcRollWidthM", "Roll width (m)", 0.1)}
          {numInput("pvcRollLengthM", "Roll length (m)", 1)}
        </div>
      )}
      {floorType === "tile" && (
        <div className="grid grid-cols-2 gap-2">
          {numInput("ppTileCm", "Tile size (cm)", 1)}
          {numInput("ppTileThicknessMm", "Tile thickness (mm)", 1)}
        </div>
      )}
      {floorType === "acrylic" && (
        <div className="text-[10px] text-slate-400 leading-snug">
          Acrylic is coated by area — no roll or tile size needed.
        </div>
      )}

      {/* 4 — Wastage */}
      <div className="grid grid-cols-2 gap-2">
        {numInput("wastagePct", "Wastage (%)", 1)}
      </div>

      {/* 5 — Calculate */}
      <button
        type="button"
        onClick={() => recalc(floorType, sizes)}
        className="btn btn-primary w-full py-1.5 text-xs"
      >
        Calculate
      </button>

      {/* 6 — Result snapshot — highlighted so it stands out after Calculate */}
      <div className="rounded-md border-2 border-court-300 bg-court-50 p-2.5">
        <div className="text-[10px] font-bold uppercase tracking-wide text-court-700 mb-1">Result</div>
        <div className="text-xs text-slate-700 space-y-0.5">{result}</div>
      </div>

      <div className="text-[10px] text-slate-400 leading-snug">
        Roll / tile sizes are saved as your standard and reused on the next
        design.
      </div>
    </div>
  );
}
