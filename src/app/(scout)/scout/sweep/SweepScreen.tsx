"use client";

import type * as LeafletNS from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/scout/ui";
import { SectionLabel, StateBlock } from "@/components/scout/patterns";
import { SiteMap } from "@/components/scout/map";
import type { BaseLayerSpec, SatelliteLayerResponse } from "@/components/scout/map/siteMapConfig";
import {
  cellCentre,
  cellSizeMetres,
  countCells,
  markedCells,
  nextSweepStatus,
  planGrid,
  restoreMarks,
  satelliteLink,
  splitCell,
  splitCellOnDoubleClick,
  streetViewLink,
  sweepNotePlaceholder,
  sweepStatusLabel,
  sweepToCsv,
  SWEEP_CELL_SIZES_M,
  type SweepBounds,
  type SweepCell,
  type SweepDocument,
} from "@/lib/scout/sweep/grid";

export interface SweepScreenProps {
  scanId: string;
  areaLabel: string;
  centre: { lat: number; lng: number };
  radiusM: number;
  initialSweep: SweepDocument | null;
}

/** Debounce before persisting. Long enough to absorb a burst of clicks. */
const SAVE_DEBOUNCE_MS = 700;

interface CellRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * D3 — the spaces sweep.
 *
 * ## Satellite imagery, or an honest admission
 *
 * This is the one screen a street map cannot serve: a vacant plot and a built
 * plot look identical in OSM's rendering, so a surveyor marking cells from it
 * would be guessing. `GET /api/scout/map/satellite` mints a Google Map Tiles session
 * and this screen swaps the tiles in place. When no browser key is configured
 * it falls back to OSM **and keeps the mockup's "satellite imagery
 * unavailable" overlay** — a street map presented as imagery is worse than no
 * imagery at all.
 *
 * ## Why the grid is an HTML overlay rather than map polygons
 *
 * Cells have to be reachable by keyboard and readable by a screen reader, and
 * they carry the mockup's exact 11px/700/.06em id in the corner. They are real
 * `<button>` elements, laid out from the map's own projection.
 *
 * Panning is a pure translation at a fixed zoom, so the layout is computed once
 * per zoom level and the whole layer is moved with a transform while the map
 * drags. Recomputing three hundred rectangles per animation frame is the
 * difference between a grid that sticks to the ground and one that stutters.
 */
export function SweepScreen({
  scanId,
  areaLabel,
  centre,
  radiusM,
  initialSweep,
}: SweepScreenProps) {
  const [cellSizeM, setCellSizeM] = useState(initialSweep?.cellSizeM ?? 500);
  /**
   * Only marked cells are stored; the rest are rebuilt from the stored bounds
   * and cell size. So a surveyor coming back to a sweep sees the whole grid
   * exactly where they left it, without a row carrying three hundred empty
   * cells.
   */
  const [cells, setCells] = useState<SweepCell[]>(() =>
    initialSweep
      ? restoreMarks(planGrid(initialSweep.bounds, initialSweep.cellSizeM).cells, initialSweep.cells)
      : [],
  );
  const [bounds, setBounds] = useState<SweepBounds | null>(initialSweep?.bounds ?? null);
  const [gridError, setGridError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [map, setMap] = useState<LeafletNS.Map | null>(null);


  const [satellite, setSatellite] = useState<SatelliteLayerResponse | null>(null);

  const layerRef = useRef<HTMLDivElement | null>(null);
  const [rects, setRects] = useState<CellRect[]>([]);
  const anchorRef = useRef<{ lat: number; lng: number; x: number; y: number } | null>(null);
  const [zooming, setZooming] = useState(false);

  /* ---------------------------------------------------- satellite imagery */

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scout/map/satellite")
      .then((r) => r.json())
      .then((json: SatelliteLayerResponse) => {
        if (!cancelled) setSatellite(json);
      })
      .catch(() => {
        if (!cancelled) {
          setSatellite({
            available: false,
            reason:
              "The satellite tile session could not be requested. This is a street map: open " +
              "ground is not distinguishable from it.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tileLayer: BaseLayerSpec | null = satellite?.available ? satellite.layer : null;

  /**
   * Open on the ground the sweep actually covers.
   *
   * The map centres on the scan by default, but a stored grid was laid over
   * whatever the surveyor had in view at the time — often a different box.
   * Without this, reopening a sweep shows an empty map with the grid off the
   * edge, and the marks look lost.
   *
   * The size check is the load-bearing part. Leaflet measures its container
   * during `L.map()`, and inside a flex column that container is routinely
   * still 0 px at that moment — `SiteMap` re-measures at 120 ms and 600 ms for
   * exactly this reason. Calling `fitBounds` before then makes Leaflet clamp to
   * its minimum zoom, and the whole grid collapses into a 20 px dot. So this
   * asks the map how big it thinks it is and only fits once the answer is
   * believable.
   */
  useEffect(() => {
    const b = initialSweep?.bounds;
    if (!map || !b) return;

    let fitted = false;
    const apply = () => {
      if (fitted) return;
      map.invalidateSize();
      if (map.getSize().x < 50) return;
      map.fitBounds(
        [
          [b.south, b.west],
          [b.north, b.east],
        ],
        { animate: false },
      );
      fitted = true;
    };

    apply();
    const timers = [setTimeout(apply, 200), setTimeout(apply, 700)];
    return () => timers.forEach(clearTimeout);
  }, [map, initialSweep]);

  /* --------------------------------------------------------- grid layout */

  const relayout = useCallback(() => {
    if (!map || cells.length === 0) {
      setRects([]);
      anchorRef.current = null;
      return;
    }
    const first = cells[0];
    if (!first) return;

    const anchorLat = first.bounds.north;
    const anchorLng = first.bounds.west;
    const anchorPoint = map.latLngToContainerPoint([anchorLat, anchorLng]);
    anchorRef.current = { lat: anchorLat, lng: anchorLng, x: anchorPoint.x, y: anchorPoint.y };

    const next: CellRect[] = [];
    for (const cell of cells) {
      const nw = map.latLngToContainerPoint([cell.bounds.north, cell.bounds.west]);
      const se = map.latLngToContainerPoint([cell.bounds.south, cell.bounds.east]);
      next.push({
        id: cell.id,
        left: nw.x,
        top: nw.y,
        width: Math.max(1, se.x - nw.x),
        height: Math.max(1, se.y - nw.y),
      });
    }
    setRects(next);
    if (layerRef.current) layerRef.current.style.transform = "translate3d(0,0,0)";
  }, [map, cells]);

  useEffect(() => {
    relayout();
  }, [relayout]);

  useEffect(() => {
    if (!map) return;

    let frame = 0;
    const onMove = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const anchor = anchorRef.current;
        const layer = layerRef.current;
        if (!anchor || !layer) return;
        const now = map.latLngToContainerPoint([anchor.lat, anchor.lng]);
        layer.style.transform = `translate3d(${now.x - anchor.x}px, ${now.y - anchor.y}px, 0)`;
      });
    };

    const onZoomStart = () => setZooming(true);
    const onZoomEnd = () => {
      setZooming(false);
      relayout();
    };

    map.on("move", onMove);
    map.on("moveend", relayout);
    map.on("zoomstart", onZoomStart);
    map.on("zoomend", onZoomEnd);
    map.on("resize", relayout);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      map.off("move", onMove);
      map.off("moveend", relayout);
      map.off("zoomstart", onZoomStart);
      map.off("zoomend", onZoomEnd);
      map.off("resize", relayout);
    };
  }, [map, relayout]);

  /* ----------------------------------------------------------- lay a grid */

  const layGrid = useCallback(() => {
    if (!map) return;
    const b = map.getBounds();
    const box: SweepBounds = {
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
    };
    const plan = planGrid(box, cellSizeM);
    if (plan.refusedReason) {
      setGridError(plan.refusedReason);
      return;
    }
    setGridError(null);
    setBounds(box);
    // Marks survive a replan: losing a surveyor's note because they changed a
    // dropdown would be unforgivable.
    setCells(restoreMarks(plan.cells, cells));
  }, [map, cellSizeM, cells]);

  /* ------------------------------------------------------------- marking */

  const cycle = useCallback((id: string) => {
    // Optimistic: the mark lands immediately and the save follows. A field
    // sweep is dozens of clicks a minute and none of them may wait on a
    // round trip.
    setCells((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: nextSweepStatus(c.status) } : c)),
    );
    setSelectedId(id);
  }, []);

  /** Keyboard split: no stray click has landed, so nothing to rewind. */
  const split = useCallback((id: string) => {
    setCells((prev) => splitCell(prev, id));
  }, []);

  /**
   * Mouse split.
   *
   * A double-click is two clicks, and the first has already cycled the cell by
   * the time this runs — so the split rewinds it, and the quadrants inherit the
   * mark the surveyor actually chose. The alternative, v16's approach, is to
   * hold every click behind a 230 ms timer in case a second one follows; that
   * puts a fifth of a second of lag on the one action this screen exists for.
   */
  const splitFromMouse = useCallback((id: string) => {
    setCells((prev) => splitCellOnDoubleClick(prev, id));
  }, []);

  const setNote = useCallback((id: string, note: string) => {
    setCells((prev) => prev.map((c) => (c.id === id ? { ...c, note } : c)));
  }, []);

  /* ------------------------------------------------------------- persist */

  /**
   * Save only a sweep that differs from the one this screen was loaded with.
   *
   * A "first render" ref would not do: React StrictMode double-invokes effects
   * in development, and the second pass would rewrite the stored sweep on every
   * page open — bumping `updatedAt` for a sweep nobody touched.
   */
  const loadedSweep = useRef(
    JSON.stringify({ cells: markedCells(initialSweep?.cells ?? []), bounds: initialSweep?.bounds ?? null }),
  );
  useEffect(() => {
    if (!bounds) return;
    if (JSON.stringify({ cells: markedCells(cells), bounds }) === loadedSweep.current) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSaveState("saving");
      setSaveError(null);
      try {
        const res = await fetch(`/api/scout/scans/${scanId}/sweep`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            sweep: { version: 1, cellSizeM, bounds, cells: markedCells(cells), updatedAt: null },
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setSaveState("saved");
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setSaveState("error");
        setSaveError(
          "The sweep did not save. Your marks are still on screen — they will save on the next " +
            "change, or reload to see what is stored.",
        );
      }
    }, SAVE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [cells, bounds, cellSizeM, scanId]);

  /* -------------------------------------------------------------- export */

  const exportCsv = useCallback(() => {
    const csv = sweepToCsv(cells);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sitescout-sweep-${areaLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [cells, areaLabel]);

  /* -------------------------------------------------------------- derived */

  const counts = useMemo(() => countCells(cells), [cells]);
  const marked = useMemo(() => markedCells(cells), [cells]);
  const rectById = useMemo(() => new Map(rects.map((r) => [r.id, r])), [rects]);

  return (
    <div className="flex-1 flex min-h-0 max-[900px]:flex-col ssIn">
      <div className="flex-1 min-w-0 relative bg-black max-[900px]:min-h-[380px]">
        <SiteMap
          className="absolute inset-0 block"
          lat={centre.lat}
          lng={centre.lng}
          radius={radiusM / 1000}
          zoom={16}
          interactive
          scrollWheelZoom
          zoomControl
          fitToRadius={false}
          showRadius={false}
          showPin={false}
          tileLayer={tileLayer}
          onReady={setMap}
          ariaLabel={`Sweep map for ${areaLabel}. Pan and zoom, then lay a grid over the view.`}
        />

        <div
          ref={layerRef}
          className={`absolute inset-0 z-[450] pointer-events-none will-change-transform${zooming ? " invisible" : ""}`}
        >
          {cells.map((cell) => {
            const rect = rectById.get(cell.id);
            if (!rect) return null;
            return (
              <button
                key={cell.id}
                type="button"
                className={`absolute pointer-events-auto font-sans text-[11px] font-bold tracking-[0.06em] flex items-start justify-start py-[7px] px-[9px] cursor-pointer transition-[background] duration-150 overflow-hidden border ${
                  cell.status === "plot"
                    ? "border-solid border-[var(--plot-amber)] bg-[rgba(232,163,61,0.55)] text-slate-900"
                    : cell.status === "terrace"
                      ? "border-solid border-turf-500 bg-[rgba(21,147,65,0.5)] text-white"
                      : cell.status === "rejected"
                        ? "border-solid border-track-500 bg-[rgba(200,17,36,0.45)] text-white"
                        : "border-dashed border-white/35 bg-transparent text-white/65"
                }${selectedId === cell.id ? " outline outline-2 outline-white -outline-offset-[3px]" : ""}`}
                style={{
                  left: `${rect.left}px`,
                  top: `${rect.top}px`,
                  width: `${rect.width}px`,
                  height: `${rect.height}px`,
                }}
                aria-label={`Cell ${cell.id}, ${sweepStatusLabel(cell.status)}. Enter cycles the mark${cell.splittable ? "; press S to split it into four" : ""}.`}
                onClick={(e) => {
                  // `detail` counts the clicks in this burst; 0 means the
                  // button was activated from the keyboard. Ignoring anything
                  // past the first stops a double-click cycling twice.
                  if (e.detail > 1) return;
                  cycle(cell.id);
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  if (cell.splittable) splitFromMouse(cell.id);
                }}
                onKeyDown={(e) => {
                  if ((e.key === "s" || e.key === "S") && cell.splittable) {
                    e.preventDefault();
                    split(cell.id);
                  }
                }}
              >
                {cell.id}
              </button>
            );
          })}
        </div>

        {satellite && !satellite.available ? (
          <div className="absolute right-5 top-5 z-[500] max-w-[340px] bg-[rgba(10,10,10,0.78)] text-white/80 rounded py-[7px] px-[11px] text-[11px] tracking-[0.02em] leading-[1.55]" role="note">
            Street map — satellite imagery unavailable. {satellite.reason}
          </div>
        ) : null}

        {gridError ? (
          <div className="absolute left-5 top-5 z-[500] max-w-[360px] bg-[var(--surface-card)] border border-[var(--plot-amber)] rounded-[12px] py-3 px-3.5 text-[12px] leading-[1.6] text-slate-700 shadow-[0_6px_18px_rgba(0,0,0,0.12)]" role="alert">
            {gridError}
          </div>
        ) : null}

        <div className="absolute left-5 bottom-5 z-[500] bg-white/95 border border-[var(--border-default)] rounded-[12px] py-[13px] px-[15px] flex gap-[18px] flex-wrap shadow-[0_6px_18px_rgba(0,0,0,0.12)]">
          <span className="flex items-center gap-2 text-xs">
            <span
              className="w-[11px] h-[11px] rounded-[3px]"
              style={{ background: "var(--plot-amber)" }}
              aria-hidden="true"
            />
            Empty plot
          </span>
          <span className="flex items-center gap-2 text-xs">
            <span
              className="w-[11px] h-[11px] rounded-[3px]"
              style={{ background: "var(--green-500)" }}
              aria-hidden="true"
            />
            Terrace
          </span>
          <span className="flex items-center gap-2 text-xs">
            <span
              className="w-[11px] h-[11px] rounded-[3px]"
              style={{ background: "var(--red-500)" }}
              aria-hidden="true"
            />
            Rejected
          </span>
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <span className="w-[11px] h-[11px] rounded-[3px] border border-dashed border-slate-500" aria-hidden="true" />
            Not swept
          </span>
        </div>
      </div>

      <aside className="w-[400px] flex-none bg-[var(--surface-card)] border-l border-[var(--border-default)] overflow-y-auto pt-6 px-[22px] pb-8 flex flex-col gap-5 max-[900px]:w-full max-[900px]:border-l-0 max-[900px]:border-t max-[900px]:border-[var(--border-default)] ss-scroll">
        <div>
          <h1 className="m-0 text-base">Spaces sweep</h1>
          <div className="text-[12.5px] text-slate-500 mt-[9px] leading-[1.6] font-sans tracking-normal normal-case">
            {areaLabel}. Pan to the ground you want to cover, lay a grid, then click a cell to cycle
            its state: empty plot, terrace, rejected. Double-click — or press S — to split a cell
            into four for a closer look.
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <div className="border border-[var(--border-default)] rounded-[12px] p-3">
            <div className="font-heading text-[22px] font-bold text-[var(--plot-amber)]">{counts.plot}</div>
            <div className="text-[10px] tracking-[0.09em] uppercase text-slate-500 mt-[5px]">Empty plots</div>
          </div>
          <div className="border border-[var(--border-default)] rounded-[12px] p-3">
            <div className="font-heading text-[22px] font-bold text-turf-500">
              {counts.terrace}
            </div>
            <div className="text-[10px] tracking-[0.09em] uppercase text-slate-500 mt-[5px]">Terraces</div>
          </div>
          <div className="border border-[var(--border-default)] rounded-[12px] p-3">
            <div className="font-heading text-[22px] font-bold text-track-500">
              {counts.rejected}
            </div>
            <div className="text-[10px] tracking-[0.09em] uppercase text-slate-500 mt-[5px]">Rejected</div>
          </div>
        </div>

        <div className="flex flex-col gap-[9px]">
          <SectionLabel weight={700}>Grid</SectionLabel>
          <div className="flex gap-2 items-center">
            <label className="srOnly" htmlFor="cell-size">
              Cell size on the ground
            </label>
            <select
              id="cell-size"
              className="flex-1 font-sans text-[13px] py-[9px] px-[11px] rounded-md border border-[var(--border-strong)] bg-[var(--surface-card)] text-slate-900 cursor-pointer"
              value={cellSizeM}
              onChange={(e) => setCellSizeM(Number(e.target.value))}
            >
              {SWEEP_CELL_SIZES_M.map((size) => (
                <option key={size} value={size}>
                  {size} m × {size} m
                </option>
              ))}
            </select>
            <Button onClick={layGrid} disabled={!map}>
              Lay grid
            </Button>
          </div>
          <p className="m-0 text-[11px] leading-[1.65] text-slate-500">
            Cells are sized in real metres on the ground, so C3 is the same square of earth every
            time you come back to it. Marks survive a resize.
          </p>
          <div className="text-[10.5px] text-slate-500 text-right" aria-live="polite">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved to this scan"
                : saveState === "error"
                  ? "Not saved"
                  : ""}
          </div>
          {saveError ? <p className="text-[11px] text-track-600 leading-[1.6]">{saveError}</p> : null}
        </div>

        <div className="flex flex-col gap-[9px]">
          <SectionLabel weight={700}>Marked cells</SectionLabel>
          {marked.length === 0 ? (
            <StateBlock
              eyebrow={cells.length === 0 ? "No grid yet" : "Nothing marked"}
              title={cells.length === 0 ? "Lay a grid to start" : "Click a cell to mark it"}
              body={
                cells.length === 0
                  ? "Pan and zoom the map to the ground you want to sweep, pick a cell size, then Lay grid. The grid covers whatever is in view."
                  : "Click any cell holding open ground, a vacant plot, or a flat unused terrace. A fourth click clears a mistake."
              }
            />
          ) : (
            marked.map((cell) => {
              const centrePoint = cellCentre(cell.bounds);
              const size = cellSizeMetres(cell.bounds);
              return (
                <div
                  key={cell.id}
                  className={`border rounded-[12px] py-3 px-[13px] flex gap-[11px] items-start ${
                    selectedId === cell.id ? "border-court-500 bg-court-100" : "border-[var(--border-default)]"
                  }`}
                >
                  <button
                    type="button"
                    className={`flex-none font-heading text-[11px] font-bold tracking-[0.06em] py-1.5 px-[9px] rounded border-0 cursor-pointer ${
                      cell.status === "plot"
                        ? "bg-[var(--plot-amber)] text-slate-900"
                        : cell.status === "terrace"
                          ? "bg-turf-500 text-white"
                          : "bg-track-500 text-white"
                    }`}
                    aria-label={`Focus cell ${cell.id} on the map`}
                    onClick={() => {
                      setSelectedId(cell.id);
                      map?.panTo([centrePoint.lat, centrePoint.lng]);
                    }}
                  >
                    {cell.id}
                  </button>
                  <div className="flex-1 min-w-0 flex flex-col gap-[5px]">
                    <span className="text-[12.5px] font-semibold">{sweepStatusLabel(cell.status)}</span>
                    <span className="text-[10.5px] text-slate-500">
                      {size.widthM} m × {size.heightM} m · {centrePoint.lat.toFixed(5)},{" "}
                      {centrePoint.lng.toFixed(5)}
                    </span>
                    <textarea
                      className="w-full font-sans text-[11.5px] leading-[1.6] text-slate-900 border border-[var(--border-default)] rounded py-[7px] px-[9px] outline-none resize-y min-h-[46px] focus:border-court-500 focus:shadow-[var(--focus-ring)]"
                      value={cell.note}
                      placeholder={sweepNotePlaceholder(cell.status)}
                      aria-label={`Note for cell ${cell.id}`}
                      onChange={(e) => setNote(cell.id, e.target.value)}
                    />
                    <span className="flex gap-3 text-[10.5px]">
                      <a
                        href={satelliteLink(centrePoint.lat, centrePoint.lng)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Satellite ↗
                      </a>
                      <a
                        href={streetViewLink(centrePoint.lat, centrePoint.lng)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Walk it ↗
                      </a>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <Button variant="secondary" block onClick={exportCsv} disabled={marked.length === 0}>
          Export marked cells (CSV)
        </Button>
        <p className="m-0 text-[11px] leading-[1.65] text-slate-500">
          Marked from satellite imagery only. Imagery is typically one to three years old — walk the
          plot before anyone commits to it.
        </p>
      </aside>
    </div>
  );
}
