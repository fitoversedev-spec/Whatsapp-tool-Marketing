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
import styles from "./Sweep.module.css";

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
    <div className={`${styles.split} ssIn`}>
      <div className={styles.mapWrap}>
        <SiteMap
          className={styles.map}
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
          className={[styles.gridLayer, zooming && styles.gridHidden].filter(Boolean).join(" ")}
        >
          {cells.map((cell) => {
            const rect = rectById.get(cell.id);
            if (!rect) return null;
            return (
              <button
                key={cell.id}
                type="button"
                className={[
                  styles.cell,
                  cell.status === "plot" && styles.cellPlot,
                  cell.status === "terrace" && styles.cellTerrace,
                  cell.status === "rejected" && styles.cellRejected,
                  selectedId === cell.id && styles.cellSelected,
                ]
                  .filter(Boolean)
                  .join(" ")}
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
          <div className={styles.imageryNote} role="note">
            Street map — satellite imagery unavailable. {satellite.reason}
          </div>
        ) : null}

        {gridError ? (
          <div className={styles.gridError} role="alert">
            {gridError}
          </div>
        ) : null}

        <div className={styles.legend}>
          <span className={styles.legendRow}>
            <span
              className={styles.legendSwatch}
              style={{ background: "var(--plot-amber)" }}
              aria-hidden="true"
            />
            Empty plot
          </span>
          <span className={styles.legendRow}>
            <span
              className={styles.legendSwatch}
              style={{ background: "var(--green-500)" }}
              aria-hidden="true"
            />
            Terrace
          </span>
          <span className={styles.legendRow}>
            <span
              className={styles.legendSwatch}
              style={{ background: "var(--red-500)" }}
              aria-hidden="true"
            />
            Rejected
          </span>
          <span className={`${styles.legendRow} ${styles.legendNone}`}>
            <span className={styles.legendSwatchNone} aria-hidden="true" />
            Not swept
          </span>
        </div>
      </div>

      <aside className={`${styles.panel} ss-scroll`}>
        <div>
          <h1 className={styles.title}>Spaces sweep</h1>
          <div className={styles.lede}>
            {areaLabel}. Pan to the ground you want to cover, lay a grid, then click a cell to cycle
            its state: empty plot, terrace, rejected. Double-click — or press S — to split a cell
            into four for a closer look.
          </div>
        </div>

        <div className={styles.counters}>
          <div className={styles.counter}>
            <div className={`${styles.counterValue} ${styles.counterPlot}`}>{counts.plot}</div>
            <div className={styles.counterLabel}>Empty plots</div>
          </div>
          <div className={styles.counter}>
            <div className={`${styles.counterValue} ${styles.counterTerrace}`}>
              {counts.terrace}
            </div>
            <div className={styles.counterLabel}>Terraces</div>
          </div>
          <div className={styles.counter}>
            <div className={`${styles.counterValue} ${styles.counterRejected}`}>
              {counts.rejected}
            </div>
            <div className={styles.counterLabel}>Rejected</div>
          </div>
        </div>

        <div className={styles.controls}>
          <SectionLabel weight={700}>Grid</SectionLabel>
          <div className={styles.controlRow}>
            <label className="srOnly" htmlFor="cell-size">
              Cell size on the ground
            </label>
            <select
              id="cell-size"
              className={styles.sizeSelect}
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
          <p className={styles.hint}>
            Cells are sized in real metres on the ground, so C3 is the same square of earth every
            time you come back to it. Marks survive a resize.
          </p>
          <div className={styles.saveState} aria-live="polite">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved to this scan"
                : saveState === "error"
                  ? "Not saved"
                  : ""}
          </div>
          {saveError ? <p className={styles.saveError}>{saveError}</p> : null}
        </div>

        <div className={styles.cells}>
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
                  className={[styles.cellRow, selectedId === cell.id && styles.cellRowOn]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button
                    type="button"
                    className={[
                      styles.chip,
                      cell.status === "plot" && styles.chipPlot,
                      cell.status === "terrace" && styles.chipTerrace,
                      cell.status === "rejected" && styles.chipRejected,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-label={`Focus cell ${cell.id} on the map`}
                    onClick={() => {
                      setSelectedId(cell.id);
                      map?.panTo([centrePoint.lat, centrePoint.lng]);
                    }}
                  >
                    {cell.id}
                  </button>
                  <div className={styles.cellBody}>
                    <span className={styles.cellLabel}>{sweepStatusLabel(cell.status)}</span>
                    <span className={styles.cellSize}>
                      {size.widthM} m × {size.heightM} m · {centrePoint.lat.toFixed(5)},{" "}
                      {centrePoint.lng.toFixed(5)}
                    </span>
                    <textarea
                      className={styles.noteInput}
                      value={cell.note}
                      placeholder={sweepNotePlaceholder(cell.status)}
                      aria-label={`Note for cell ${cell.id}`}
                      onChange={(e) => setNote(cell.id, e.target.value)}
                    />
                    <span className={styles.cellLinks}>
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
        <p className={styles.hint}>
          Marked from satellite imagery only. Imagery is typically one to three years old — walk the
          plot before anyone commits to it.
        </p>
      </aside>
    </div>
  );
}
