"use client";

// Editable, PERSISTED flooring material calculator for the court designer's
// "Flooring options" panel. It loads the sales-set standard roll/tile sizes +
// wastage % from /api/court-images/material-sizes on mount, lets the user edit
// them (debounced-persisted back so they're reused next session), and shows the
// live rolls/tiles-needed, total area and running length for the design's
// CURRENT surface — computed with the edited sizes via the schema helpers.
//
// The sizes are GLOBAL company standards (one Setting row), not per-design; the
// OUTPUT is per-design (driven by this design's plot size + active surface).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ppeTileCount,
  turfRollMeters,
  pvcRollCount,
  withWastage,
  isTiledSurface,
  isTurfSurface,
  isPvcSurface,
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

function parseField(key: keyof MaterialSizes, raw: string): number {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULTS[key];
  if (POSITIVE_ONLY.has(key) && n <= 0) return DEFAULTS[key];
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

export default function MaterialCalculator({
  plotLengthFt,
  plotWidthFt,
  surface,
}: {
  plotLengthFt: number;
  plotWidthFt: number;
  surface: SurfaceFinish;
}) {
  const [draft, setDraft] = useState<Record<keyof MaterialSizes, string>>(() =>
    draftFrom(DEFAULTS),
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only persist after the user actually edits a field — so loading the saved
  // sizes on mount doesn't immediately echo them back with a redundant POST.
  const dirty = useRef(false);

  // Load the saved sizes once on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/court-images/material-sizes")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.sizes) return;
        setDraft(draftFrom(j.sizes as MaterialSizes));
      })
      .catch(() => {
        /* keep defaults on failure */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Committed numeric sizes derived from the input drafts (invalid → default).
  const sizes: MaterialSizes = useMemo(() => {
    const out = {} as MaterialSizes;
    for (const k of FIELDS) out[k] = parseField(k, draft[k]);
    return out;
  }, [draft]);

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

  function onEdit(key: keyof MaterialSizes, value: string) {
    dirty.current = true;
    setDraft((d) => ({ ...d, [key]: value }));
  }
  function onBlur(key: keyof MaterialSizes) {
    // Snap an empty/invalid box back to the committed (parsed) value.
    setDraft((d) => ({ ...d, [key]: String(sizes[key]) }));
  }

  const L = plotLengthFt;
  const W = plotWidthFt;
  const areaSqFt = Math.round(L * W);
  const areaSqM = Math.round((L / FT_PER_M) * (W / FT_PER_M));

  const tiled = isTiledSurface(surface);
  const turf = isTurfSurface(surface);
  const pvc = isPvcSurface(surface);

  // ── Surface-specific output rows ──
  let output: ReactNode = null;
  if (tiled) {
    const tileFt = sizes.ppTileCm / CM_PER_FT;
    const c = ppeTileCount(L, W, tileFt);
    const needed = withWastage(c.total, sizes.wastagePct);
    output = (
      <>
        <div className="font-medium">
          {nf(needed)} tiles needed
          <span className="font-normal text-slate-500">
            {" "}
            (incl. {sizes.wastagePct}% wastage)
          </span>
        </div>
        <div className="text-slate-500">
          {nf(c.total)} exact · {c.perLength} × {c.perWidth} at {sizes.ppTileCm}{" "}
          × {sizes.ppTileCm} cm
          {sizes.ppTileThicknessMm > 0 ? ` · ${sizes.ppTileThicknessMm} mm thick` : ""}
        </div>
        <div className="text-slate-500">
          Total area {nf(areaSqM)} m² ({nf(areaSqFt)} sq.ft)
        </div>
      </>
    );
  } else if (turf) {
    const r = turfRollMeters(L, W, {
      rollWidthM: sizes.turfRollWidthM,
      rollLengthM: sizes.turfRollLengthM,
    });
    const baseRolls = r.lightRolls + r.darkRolls;
    const needed = withWastage(baseRolls, sizes.wastagePct);
    output = (
      <>
        <div className="font-medium">
          {nf(needed)} rolls needed
          <span className="font-normal text-slate-500">
            {" "}
            (incl. {sizes.wastagePct}% wastage)
          </span>
        </div>
        <div className="text-slate-500">
          {baseRolls} exact · Light {r.lightRolls} + Dark {r.darkRolls} ·{" "}
          {sizes.turfRollWidthM} × {sizes.turfRollLengthM} m rolls
        </div>
        <div className="text-slate-500">
          Running length {nf(r.totalMeters)} m · {r.stripes} stripes · total area{" "}
          {nf(areaSqM)} m²
        </div>
      </>
    );
  } else if (pvc) {
    const p = pvcRollCount(L, W, {
      rollWidthM: sizes.pvcRollWidthM,
      rollLengthM: sizes.pvcRollLengthM,
    });
    const needed = withWastage(p.rolls, sizes.wastagePct);
    output = (
      <>
        <div className="font-medium">
          {nf(needed)} rolls needed
          <span className="font-normal text-slate-500">
            {" "}
            (incl. {sizes.wastagePct}% wastage)
          </span>
        </div>
        <div className="text-slate-500">
          {p.rolls} exact · {sizes.pvcRollWidthM} m wide × {sizes.pvcRollLengthM}{" "}
          m long
        </div>
        <div className="text-slate-500">
          Total area {nf(p.totalSqM)} m² ({nf(areaSqFt)} sq.ft) · running length{" "}
          {nf(p.runningMeters)} m
        </div>
      </>
    );
  } else {
    output = (
      <div className="text-slate-500">
        Roll / tile estimate applies to artificial grass, PVC and PP-tile
        surfaces.
      </div>
    );
  }

  const numInput = (
    key: keyof MaterialSizes,
    label: string,
    step: number,
  ) => (
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

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md p-2 space-y-0.5">
        {output}
      </div>
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
        Material sizes &amp; wastage
      </div>
      <div className="grid grid-cols-2 gap-2">
        {numInput("turfRollWidthM", "Turf roll W (m)", 0.1)}
        {numInput("turfRollLengthM", "Turf roll L (m)", 1)}
        {numInput("pvcRollWidthM", "PVC roll W (m)", 0.1)}
        {numInput("pvcRollLengthM", "PVC roll L (m)", 1)}
        {numInput("ppTileCm", "PP tile (cm)", 1)}
        {numInput("ppTileThicknessMm", "Tile thick (mm)", 1)}
        {numInput("wastagePct", "Wastage (%)", 1)}
      </div>
      <div className="text-[10px] text-slate-400 leading-snug">
        Sizes are saved as your standard and reused on the next design.
      </div>
    </div>
  );
}
