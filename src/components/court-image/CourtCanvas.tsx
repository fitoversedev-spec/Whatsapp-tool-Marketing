"use client";

// 2D editable canvas built on react-konva. Every element in the layout is
// rendered into its own Konva.Group with drag/resize/rotate handles
// attached via Transformer when selected. Plot coordinates (feet, origin
// bottom-left) are converted to canvas pixels on every render. Position
// and dimension changes flow back to the parent through onUpdate so the
// layout JSON stays the single source of truth.
//
// Renderer dispatch is inline (switch on element.type) rather than a
// per-shape file so the schema + canvas stay easy to read together.

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import {
  Stage,
  Layer,
  Rect,
  Group,
  Transformer,
  Text,
  Line,
  Circle,
  Arc,
  Path,
  Image as KonvaImage,
} from "react-konva";
import Konva from "konva";
import type {
  CourtLayout,
  Element,
  FootballFieldElement,
  CricketPitchElement,
  BasketballCourtElement,
  PickleballCourtElement,
  GenericCourtElement,
  GoalPostElement,
  NetElement,
  AnnotationElement,
  CustomLineElement,
  CustomRectElement,
  FenceRectElement,
  DugoutElement,
  BasketballHoopElement,
  HighlightZoneElement,
  FloodlightElement,
  SeatingElement,
  ScoreboardElement,
  SightScreenElement,
  CornerFlagElement,
  GateElement,
  CenterLogoElement,
} from "@/lib/court-image/schema";
import {
  aSideProps,
  SURFACE_IMAGE_URL,
  SURFACE_SOLID_COLOR,
  SURFACE_TILE_METERS,
  TURF_IMAGE_URLS,
  TURF_STRIPE_COLORS,
  TURF_ROLL_WIDTH_M,
  PPE_TILE_FT,
  isTiledSurface,
  isAcrylicSurface,
  isTurfSurface,
  isPvcSurface,
  ppeTileCount,
  acrylicLitres,
  turfRollMeters,
  pvcRollCount,
  resolveGroundColor,
  shadeHexColor,
  runOffFactor,
  HIGHLIGHT_PRESETS,
  KITCHEN_DEFAULT_COLOR,
  computeDesignAreas,
  type HighlightSectionPreset,
  type SurfaceFinish,
  type DesignAreas,
  type Sport,
} from "@/lib/court-image/schema";
import { buildLegend, LINE_BREAK_MM } from "@/lib/court-image/line-marking";

export type CourtCanvasHandle = {
  // Exports the current canvas state to a PNG dataURL at the given pixel
  // ratio (1 = canvas pixels, 2 = retina, 3 = print-ready). Used by Step 3
  // to upload a high-DPI image to blob storage.
  toDataURL: (pixelRatio?: number) => string | null;
};

type Props = {
  layout: CourtLayout;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<Element>) => void;
  // Canvas dimensions in CSS pixels. Parent controls so we can keep the
  // editor responsive without remounting.
  canvasWidth: number;
  canvasHeight: number;
  // Called when sales clicks a dashed section overlay on the canvas
  // (basketball key, tennis service box, etc.). Fires with the parent
  // court element + the preset that was clicked; the wizard creates a
  // HighlightZoneElement at the correct world position via
  // highlightZoneFromPreset. Optional — canvas still renders if the
  // parent doesn't wire it.
  onSectionClick?: (
    court: Element,
    preset: HighlightSectionPreset,
  ) => void;
  showGrid?: boolean;
  // When set, the canvas refuses to mutate elements — useful for Step 3
  // preview rendering. Drag/transform handles still appear but events are
  // suppressed.
  readOnly?: boolean;
  // Imperative handle injected via prop instead of forwardRef. We pass via
  // prop because next/dynamic doesn't forward refs through its LoadableComponent
  // wrapper, and this canvas must be dynamically imported (no SSR for Konva).
  // The parent passes a ref object; we mutate its `.current` on mount.
  handleRef?: MutableRefObject<CourtCanvasHandle | null>;
};

export default function CourtCanvas({
  layout,
  selectedId,
  onSelect,
  onUpdate,
  canvasWidth,
  canvasHeight,
  onSectionClick,
  showGrid = true,
  readOnly = false,
  handleRef,
}: Props) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Record<string, Konva.Group>>({});
  // P1-08: dedicated overlay layer for the temporary magenta alignment guides.
  // Guides are drawn imperatively during a drag (no React re-render of every
  // element per mouse-move) and cleared on drag end.
  const guideLayerRef = useRef<Konva.Layer>(null);

  // Plot-to-canvas conversion. We compute a single scale so the plot fills
  // as much of the canvas as possible while preserving aspect ratio.
  // Non-plain surfaces reserve extra space on the right for the material
  // callout (sample photo/swatch + quantity) so the callout sits outside
  // the court, not on top of it. Turf callouts show TWO photos stacked
  // (light + dark) so they need more vertical room; reserved width is
  // the same for all non-plain surfaces to keep the layout uniform.
  const { pxPerFt, plotOriginX, plotOriginY, plotPxWidth, plotPxHeight } = useMemo(() => {
    const margin = 28; // leave room for the ground border + dimension labels
    // Always reserve the right column — it holds the prominent DIMENSIONS
    // card (shown for every design) with the material callout below it.
    const rightExtra = RIGHT_COL_W;
    const availW = canvasWidth - margin * 2 - rightExtra;
    const availH = canvasHeight - margin * 2;
    const scale = Math.min(availW / layout.plot.lengthFt, availH / layout.plot.widthFt);
    const w = layout.plot.lengthFt * scale;
    const h = layout.plot.widthFt * scale;
    return {
      pxPerFt: scale,
      // Centre the plot within its allotted (canvas − reserved right)
      // area so the run-off + dimensions stay symmetric on the left.
      plotOriginX: (canvasWidth - rightExtra - w) / 2,
      plotOriginY: (canvasHeight - h) / 2,
      plotPxWidth: w,
      plotPxHeight: h,
    };
  }, [canvasWidth, canvasHeight, layout.plot.lengthFt, layout.plot.widthFt]);

  // Right-column layout: the DIMENSIONS card is anchored at the canvas top
  // (DIM_TOP), and the material/product callout drops directly below it.
  // Computed here (not from the plot) so the stack never overlaps for short
  // plots like a cricket strip.
  const designAreas = computeDesignAreas(layout);
  const calloutTopY = DIM_TOP + dimPanelHeight(designAreas) + 10;

  // Convert plot coords (origin bottom-left) to Konva canvas coords (origin
  // top-left). Used everywhere we draw or read positions.
  function toCanvasX(plotX: number): number {
    return plotOriginX + plotX * pxPerFt;
  }
  function toCanvasY(plotY: number): number {
    return plotOriginY + (layout.plot.widthFt - plotY) * pxPerFt;
  }
  function fromCanvasX(canvasX: number): number {
    return (canvasX - plotOriginX) / pxPerFt;
  }
  function fromCanvasY(canvasY: number): number {
    return layout.plot.widthFt - (canvasY - plotOriginY) / pxPerFt;
  }

  // P1-08: canvas-space snap anchors for the alignment guides — the plot's
  // centre + four edges, plus every element's centre. `id` lets the dragged
  // element exclude its own anchor so it never snaps to where it started.
  // Kept in canvas px so the drag handler can compare against node.x()/y()
  // directly without re-converting on every mouse-move.
  const alignAnchors = useMemo(() => {
    const lenFt = layout.plot.lengthFt;
    const widFt = layout.plot.widthFt;
    const xs: { id: string; v: number }[] = [
      { id: "__plot", v: plotOriginX + (lenFt / 2) * pxPerFt },
      { id: "__plot", v: plotOriginX },
      { id: "__plot", v: plotOriginX + plotPxWidth },
    ];
    const ys: { id: string; v: number }[] = [
      { id: "__plot", v: plotOriginY + (widFt / 2) * pxPerFt },
      { id: "__plot", v: plotOriginY },
      { id: "__plot", v: plotOriginY + plotPxHeight },
    ];
    for (const el of layout.elements) {
      xs.push({ id: el.id, v: plotOriginX + el.x * pxPerFt });
      ys.push({ id: el.id, v: plotOriginY + (widFt - el.y) * pxPerFt });
    }
    return { xs, ys };
  }, [
    layout.elements,
    layout.plot.lengthFt,
    layout.plot.widthFt,
    plotOriginX,
    plotOriginY,
    plotPxWidth,
    plotPxHeight,
    pxPerFt,
  ]);

  // Draw / clear the magenta alignment guides on the overlay layer. Vertical
  // guides span the plot height, horizontal guides span the plot width. Drawn
  // imperatively (Konva nodes, not JSX) so a live drag doesn't re-render React.
  function drawGuides(g: { x: number[]; y: number[] }) {
    const layer = guideLayerRef.current;
    if (!layer) return;
    layer.destroyChildren();
    const top = plotOriginY;
    const bottom = plotOriginY + plotPxHeight;
    const left = plotOriginX;
    const right = plotOriginX + plotPxWidth;
    for (const x of g.x) {
      layer.add(
        new Konva.Line({
          points: [x, top, x, bottom],
          stroke: "#ff2fd6",
          strokeWidth: 1,
          dash: [4, 4],
          listening: false,
        }),
      );
    }
    for (const y of g.y) {
      layer.add(
        new Konva.Line({
          points: [left, y, right, y],
          stroke: "#ff2fd6",
          strokeWidth: 1,
          dash: [4, 4],
          listening: false,
        }),
      );
    }
    layer.batchDraw();
  }
  function clearGuides() {
    const layer = guideLayerRef.current;
    if (!layer) return;
    layer.destroyChildren();
    layer.batchDraw();
  }

  // Track latest selectedId in a ref so the toDataURL closure can use it
  // without the install effect re-running on every selection change (which
  // had a brief null window if the user clicked Preview mid-transition).
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // Install the imperative handle on the parent's ref object once.
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      toDataURL(pixelRatio = 2) {
        const stage = stageRef.current;
        if (!stage) return null;
        // Deselect briefly so the export doesn't include handle overlays.
        transformerRef.current?.nodes([]);
        transformerRef.current?.getLayer()?.batchDraw();
        // Hide the editor-only dashed section-click overlays AND the DIMENSIONS
        // card so the exported 2D diagram is clean — the dimensions render as a
        // dedicated table in the combined PDF instead.
        const overlays = stage.find(".section-overlay");
        const dimPanel = stage.find(".dim-panel");
        overlays.forEach((n) => n.hide());
        dimPanel.forEach((n) => n.hide());
        stage.batchDraw();
        const url = stage.toDataURL({ pixelRatio, mimeType: "image/png" });
        overlays.forEach((n) => n.show());
        dimPanel.forEach((n) => n.show());
        const sel = selectedIdRef.current;
        if (sel && shapeRefs.current[sel]) {
          transformerRef.current?.nodes([shapeRefs.current[sel]]);
          transformerRef.current?.getLayer()?.batchDraw();
        }
        stage.batchDraw();
        return url;
      },
    };
    return () => {
      if (handleRef) handleRef.current = null;
    };
  }, [handleRef]);

  // Re-attach the transformer to whichever shape matches selectedId.
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (!selectedId || readOnly) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const node = shapeRefs.current[selectedId];
    if (node) {
      tr.nodes([node]);
      tr.getLayer()?.batchDraw();
    }
  }, [selectedId, layout.elements, readOnly]);

  // Click on empty canvas deselects.
  function handleStageClick(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (e.target === e.target.getStage()) onSelect(null);
  }

  const sortedElements = useMemo(
    () => [...layout.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)),
    [layout.elements]
  );

  // Alternate each court's name/dimension label between the LEFT and RIGHT top
  // corner, so overlaid same-size courts (e.g. pickleball + badminton) don't
  // print their labels on top of each other. Largest court first = left.
  const courtLabelSides = useMemo(() => {
    const courtTypes = new Set([
      "football-field",
      "basketball-court",
      "pickleball-court",
      "generic-court",
    ]);
    const courts = layout.elements
      .filter((e) => courtTypes.has(e.type))
      .sort((a, b) => {
        const az = "width" in a ? (a as { width?: number }).width ?? 0 : 0;
        const bz = "width" in b ? (b as { width?: number }).width ?? 0 : 0;
        return bz - az;
      });
    const map: Record<string, "left" | "right"> = {};
    courts.forEach((e, i) => {
      map[e.id] = i % 2 === 0 ? "left" : "right";
    });
    return map;
  }, [layout.elements]);

  // P2-01: multi-sport line differentiation. Two dead systems from the
  // line-marking spec are wired here:
  //   (a) priority line-BREAKS at crossings — each overlaid court renders a
  //       surface-coloured halo UNDER its own markings; because the concentric
  //       stack draws the smaller/higher-priority courts last (on top), their
  //       halo carves a clean gap into the lower-priority lines they cross
  //       (LINE_BREAK_MM per side), so both sports' markings stay readable.
  //   (b) an on-canvas colour LEGEND (buildLegend) mapping each sport to its
  //       actual rendered line colour.
  const overlayHalo = useMemo(() => {
    if (new Set(layout.sports).size < 2) return undefined;
    const s = layout.style;
    const color =
      s.surfaceColorOverride ??
      TILE_SOLID_COLORS[s.surface] ??
      SURFACE_SOLID_COLOR[s.surface] ??
      "#2f6d3a";
    // LINE_BREAK_MM (mm) → canvas px (304.8 mm per foot). At true scale a 22 mm
    // break is sub-pixel on a plot-wide view, so floor it to a readable gap
    // (the break exists for legibility at crossings, not literal survey width).
    const breakPx = Math.max(2, (LINE_BREAK_MM * pxPerFt) / 304.8);
    return { color, breakPx };
  }, [layout.sports, layout.style, pxPerFt]);

  // Colour legend for multi-sport plots. Order + labels come from
  // buildLegend (line-marking priority); each colour is overridden with the
  // court's ACTUAL rendered line colour so the swatches match the canvas
  // (including any per-court override).
  const legend = useMemo(() => {
    const sportSet = new Set<Sport>();
    const colorBySport = new Map<Sport, string>();
    for (const el of layout.elements) {
      const sp = sportOfElement(el);
      if (!sp) continue;
      sportSet.add(sp);
      const lc = (el as { lineColor?: string }).lineColor;
      if (lc && !colorBySport.has(sp)) colorBySport.set(sp, lc);
    }
    if (sportSet.size < 2) return [];
    return buildLegend([...sportSet]).map((e) => ({
      ...e,
      color: colorBySport.get(e.sport) ?? e.color,
    }));
  }, [layout.elements]);

  return (
    <Stage
      ref={stageRef}
      width={canvasWidth}
      height={canvasHeight}
      onMouseDown={handleStageClick}
      onTouchStart={handleStageClick}
    >
      {/* Ground + plot background */}
      <Layer listening={false}>
        <Rect
          x={0}
          y={0}
          width={canvasWidth}
          height={canvasHeight}
          fill={resolveGroundColor(
            layout.style.groundFinish,
            layout.style.groundColor,
            layout.style.groundColorOverride,
          )}
        />
        {/* Base work (concrete / asphalt sub-base) — the foundation the
            court is built on. Drawn as a slab under the plot that extends a
            little past it, so a concrete/asphalt frame shows around the
            court — mirroring the raised base pad in the 3D view (colours
            match: asphalt #35383d, concrete #c2c8ce). */}
        {layout.style.baseWork &&
          (() => {
            const m = Math.max(6, 1.8 * pxPerFt);
            return (
              <Rect
                x={plotOriginX - m}
                y={plotOriginY - m}
                width={plotPxWidth + 2 * m}
                height={plotPxHeight + 2 * m}
                cornerRadius={3}
                fill={layout.style.baseWork === "asphalt" ? "#35383d" : "#c2c8ce"}
              />
            );
          })()}
        {/* Plot footprint (the actual customer land) — drawn with a faint
            border so even a blank plot is visible against the ground.
            When a tiled surface is picked (e.g. PPE tile), the plot is
            filled with the tile photo repeated at real scale rather than
            the default earth colour. */}
        <PlotSurface
          plotOriginX={plotOriginX}
          plotOriginY={plotOriginY}
          plotPxWidth={plotPxWidth}
          plotPxHeight={plotPxHeight}
          pxPerFt={pxPerFt}
          surface={layout.style.surface}
          plotLengthFt={layout.plot.lengthFt}
          plotWidthFt={layout.plot.widthFt}
          polygon={layout.plot.polygon}
          runOffTone={layout.style.runOffTone}
          runOffColorOverride={layout.style.runOffColorOverride}
          surfaceColorOverride={layout.style.surfaceColorOverride}
          baseWork={layout.style.baseWork}
          productName={layout.style.flooringProductName}
          productImageUrl={layout.style.flooringProductImageUrl}
          calloutTopY={calloutTopY}
          canvasHeight={canvasHeight}
          canvasWidth={canvasWidth}
          borderColor={layout.style.borderColor}
          primarySport={layout.primarySport ?? layout.sports[0]}
        />
        {/* P6-02: obstacle marker (kidney tree/pole the boundary curves
            around). Drawn in the plot layer so it reads as part of the site. */}
        {layout.plot.obstacle && (
          <ObstacleMarker
            x={toCanvasX(layout.plot.obstacle.x)}
            y={toCanvasY(layout.plot.obstacle.y)}
            radiusPx={Math.max(6, (layout.plot.obstacle.radiusFt ?? 3) * pxPerFt)}
            kind={layout.plot.obstacle.kind ?? "tree"}
          />
        )}
      </Layer>

      {/* Element layer — sorted by z so cricket pitch sits above football.
          When a plot polygon is set (non-standard mode), the layer is
          clipped to the polygon so elements can't spill into the cut
          zones. In standard/rectangular mode there's no clip and
          elements can be dragged freely up to the plot boundary. */}
      <Layer
        clipFunc={
          layout.plot.polygon && layout.plot.polygon.length >= 3
            ? (ctx: any) => {
                const poly = layout.plot.polygon!;
                ctx.beginPath();
                for (let i = 0; i < poly.length; i++) {
                  const p = poly[i];
                  const cx = plotOriginX + p.x * pxPerFt;
                  const cy = plotOriginY + (layout.plot.widthFt - p.y) * pxPerFt;
                  if (i === 0) ctx.moveTo(cx, cy);
                  else ctx.lineTo(cx, cy);
                }
                ctx.closePath();
              }
            : undefined
        }
      >
        {sortedElements.map((el) => (
          <ElementShape
            key={el.id}
            element={el}
            pxPerFt={pxPerFt}
            toCanvasX={toCanvasX}
            toCanvasY={toCanvasY}
            fromCanvasX={fromCanvasX}
            fromCanvasY={fromCanvasY}
            style={layout.style}
            isSelected={selectedId === el.id}
            readOnly={readOnly}
            overlayHalo={
              overlayHalo && HALO_COURT_TYPES.has(el.type)
                ? overlayHalo
                : undefined
            }
            labelSide={courtLabelSides[el.id] ?? "left"}
            onSelect={() => onSelect(el.id)}
            onUpdate={(patch) => onUpdate(el.id, patch)}
            onSectionClick={onSectionClick}
            alignAnchors={alignAnchors}
            drawGuides={drawGuides}
            clearGuides={clearGuides}
            registerRef={(node) => {
              if (node) shapeRefs.current[el.id] = node;
              else delete shapeRefs.current[el.id];
            }}
          />
        ))}
      </Layer>

      {/* Alignment-guide overlay (P1-08) — populated imperatively during a
          drag; empty otherwise. Above the elements so guides stay visible. */}
      <Layer ref={guideLayerRef} listening={false} />

      {/* Tile grid overlay — drawn ABOVE the courts so the PP-tile grid stays
          visible even when a court is given an opaque colour (the bug was the
          coloured court fill hiding the base-layer grid). The lines are faint
          white, so they read as tile edges over coloured areas and vanish over
          the white court markings. Only shown for tiled surfaces (showGrid). */}
      {showGrid && (
        <Layer listening={false}>
          <GridLines
            pxPerFt={pxPerFt}
            plotOriginX={plotOriginX}
            plotOriginY={plotOriginY}
            plotPxWidth={plotPxWidth}
            plotPxHeight={plotPxHeight}
            plotLengthFt={layout.plot.lengthFt}
            plotWidthFt={layout.plot.widthFt}
          />
        </Layer>
      )}

      {/* Dimensions layer — drawn AFTER elements so the width/length
          labels are never hidden by an oversized pitch or fence. Listening
          disabled so labels don't intercept clicks meant for elements. */}
      {layout.style.showDimensions !== false && (
        <Layer listening={false}>
          <PlotDimensions
            plotOriginX={plotOriginX}
            plotOriginY={plotOriginY}
            plotPxWidth={plotPxWidth}
            plotPxHeight={plotPxHeight}
            plotLengthFt={layout.plot.lengthFt}
            plotWidthFt={layout.plot.widthFt}
          />
          <DesignInfoPanel
            areas={designAreas}
            top={DIM_TOP}
            canvasWidth={canvasWidth}
          />
        </Layer>
      )}

      {/* P2-01: multi-sport line-colour legend — bottom-left of the plot,
          keyed to each sport's actual line colour so the customer can tell the
          overlaid markings apart. Only shown when 2+ sports share the plot. */}
      {legend.length > 0 && (
        <Layer listening={false}>
          <CourtLegend
            entries={legend}
            x={plotOriginX + 8}
            bottom={plotOriginY + plotPxHeight - 8}
          />
        </Layer>
      )}

      {/* Watermark layer — bottom-right corner, on top of every element so
          it's always visible in the export. */}
      {layout.style.watermarkUrl && (
        <Layer listening={false}>
          <Watermark
            url={layout.style.watermarkUrl}
            opacity={layout.style.watermarkOpacity ?? 0.9}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
          />
        </Layer>
      )}

      {/* Transformer layer — drawn on top so handles are always clickable */}
      <Layer>
        {!readOnly && (
          <Transformer
            ref={transformerRef}
            rotateEnabled={true}
            // P1-09: snap rotation to 45° increments (within 7°) so a court is
            // never left at a scruffy 37°; and lock the aspect ratio for
            // regulation court/field types so a corner-drag can't squash them
            // off-true (run-off is derived, so the playing area must stay true).
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={7}
            keepRatio={ASPECT_LOCK_TYPES.has(
              layout.elements.find((e) => e.id === selectedId)?.type ?? "",
            )}
            boundBoxFunc={(oldBox, newBox) => {
              // Prevent collapsing an element to a truly degenerate box.
              // Previously used a 12x12 minimum which blocked rotation on
              // thin elements like Net (~8px tall) — dropping to 4x4 keeps
              // the collapse guard but lets nets and lines rotate freely.
              if (Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4) {
                return oldBox;
              }
              return newBox;
            }}
            anchorSize={9}
            anchorCornerRadius={5}
            anchorStroke="#2f8c3e"
            anchorFill="#ffffff"
            borderStroke="#2f8c3e"
            borderDash={[6, 4]}
          />
        )}
      </Layer>
    </Stage>
  );
}

// Regulation court/field types whose aspect ratio must stay true (run-off is
// derived from the playing area) — the Transformer locks ratio for these (P1-09).
const ASPECT_LOCK_TYPES = new Set<string>([
  "football-field",
  "cricket-pitch",
  "basketball-court",
  "pickleball-court",
  "generic-court",
]);

// P2-01: map a court element to the sport whose lines it carries — used for the
// multi-sport legend + crossing-break wiring. Mirrors buildInitialLayout's
// sportForType (schema.ts).
function sportOfElement(el: Element): Sport | null {
  switch (el.type) {
    case "basketball-court":
      return "basketball";
    case "football-field":
      return "football";
    case "pickleball-court":
      return "pickleball";
    case "cricket-pitch":
      return "cricket";
    case "generic-court":
      return (el as GenericCourtElement).sport;
    default:
      return null;
  }
}

// P2-01: the concentric-stack court shapes that render a crossing-break halo
// under their markings. Football is excluded — it's the largest/lowest-priority
// court (drawn first, at the bottom), so nothing sits beneath it to break; the
// courts stacked ABOVE it supply the halos that break football's own lines.
const HALO_COURT_TYPES = new Set<string>([
  "basketball-court",
  "pickleball-court",
  "generic-court",
]);

// ─────────────────────────────────────────────────────────────────────
//  Element renderer
// ─────────────────────────────────────────────────────────────────────

type ElementShapeProps = {
  element: Element;
  pxPerFt: number;
  toCanvasX: (plotX: number) => number;
  toCanvasY: (plotY: number) => number;
  fromCanvasX: (canvasX: number) => number;
  fromCanvasY: (canvasY: number) => number;
  style: CourtLayout["style"];
  isSelected: boolean;
  readOnly: boolean;
  labelSide?: "left" | "right";
  onSelect: () => void;
  onUpdate: (patch: Partial<Element>) => void;
  onSectionClick?: (
    court: Element,
    preset: HighlightSectionPreset,
  ) => void;
  // P1-08: canvas-space snap anchors + imperative guide draw/clear callbacks.
  alignAnchors?: { xs: { id: string; v: number }[]; ys: { id: string; v: number }[] };
  drawGuides?: (g: { x: number[]; y: number[] }) => void;
  clearGuides?: () => void;
  registerRef: (node: Konva.Group | null) => void;
  // P2-01: when set (multi-sport plots), overlaid courts render a
  // surface-coloured halo under their markings so higher-priority courts break
  // the lines they cross. `breakPx` = LINE_BREAK_MM converted to canvas px.
  overlayHalo?: { color: string; breakPx: number };
};

// P1-08: how close (canvas px) a dragged element's centre must come to an
// anchor before it snaps + shows a guide. ~6px feels magnetic without fighting.
const ALIGN_SNAP_PX = 6;

function ElementShape({
  element,
  pxPerFt,
  labelSide,
  onSectionClick,
  toCanvasX,
  toCanvasY,
  fromCanvasX,
  fromCanvasY,
  style,
  isSelected,
  readOnly,
  onSelect,
  onUpdate,
  alignAnchors,
  drawGuides,
  clearGuides,
  registerRef,
  overlayHalo,
}: ElementShapeProps) {
  const groupRef = useRef<Konva.Group>(null);
  // P2-01: halo pass props — a wider surface-coloured underlay of this court's
  // strokes. `breakPx` is added to EACH side of every line (×2 on the width).
  const strokeOverride = overlayHalo
    ? { color: overlayHalo.color, extraPx: overlayHalo.breakPx * 2 }
    : undefined;

  useEffect(() => {
    registerRef(groupRef.current);
    return () => registerRef(null);
  }, [registerRef]);

  // P1-08: snap the live drag. Base is a 1 ft grid so elements land tidily;
  // then, if the dragged centre comes within ALIGN_SNAP_PX of a plot centre /
  // edge or another element's centre, it snaps to that anchor exactly and a
  // magenta guide is drawn. Alignment wins over the grid because it's the
  // stronger intent. Returns the final canvas position of the node.
  function snapNodeToGuides(node: Konva.Node) {
    const rawX = node.x();
    const rawY = node.y();
    // 1 ft grid baseline.
    let cx = toCanvasX(Math.round(fromCanvasX(rawX)));
    let cy = toCanvasY(Math.round(fromCanvasY(rawY)));
    const guides: { x: number[]; y: number[] } = { x: [], y: [] };
    if (alignAnchors) {
      let bestX: number | null = null;
      let bestXd = ALIGN_SNAP_PX;
      for (const a of alignAnchors.xs) {
        if (a.id === element.id) continue;
        const d = Math.abs(a.v - rawX);
        if (d <= bestXd) {
          bestXd = d;
          bestX = a.v;
        }
      }
      let bestY: number | null = null;
      let bestYd = ALIGN_SNAP_PX;
      for (const a of alignAnchors.ys) {
        if (a.id === element.id) continue;
        const d = Math.abs(a.v - rawY);
        if (d <= bestYd) {
          bestYd = d;
          bestY = a.v;
        }
      }
      if (bestX !== null) {
        cx = bestX;
        guides.x.push(bestX);
      }
      if (bestY !== null) {
        cy = bestY;
        guides.y.push(bestY);
      }
    }
    node.x(cx);
    node.y(cy);
    drawGuides?.(guides);
    return { cx, cy };
  }

  function handleDragMove(e: Konva.KonvaEventObject<DragEvent>) {
    snapNodeToGuides(e.target);
  }

  function handleDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    const { cx, cy } = snapNodeToGuides(e.target);
    clearGuides?.();
    // Commit exact feet: an integer when grid-snapped, or the aligned anchor's
    // position (which may be a half-foot, e.g. an odd-length plot centre).
    onUpdate({ x: fromCanvasX(cx), y: fromCanvasY(cy) });
  }

  // Transformer applies scaleX/scaleY to the group. We bake the scale into
  // the element's actual dimensions and reset scale to 1 so the element
  // renders at the new size on the next render.
  function handleTransformEnd(e: Konva.KonvaEventObject<Event>) {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    const newRotation = node.rotation();
    const plotX = fromCanvasX(node.x());
    const plotY = fromCanvasY(node.y());
    const patch: Partial<Element> = {
      x: plotX,
      y: plotY,
      rotation: newRotation,
    };
    applyScaleToDimensions(element, scaleX, scaleY, patch);
    onUpdate(patch);
  }

  const commonGroupProps = {
    x: toCanvasX(element.x),
    y: toCanvasY(element.y),
    rotation: element.rotation,
    draggable: !readOnly && !element.locked,
    onClick: onSelect,
    onTap: onSelect,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onTransformEnd: handleTransformEnd,
    ref: groupRef,
    visible: element.visible !== false,
  };

  switch (element.type) {
    case "football-field":
      return (
        <Group {...commonGroupProps}>
          <FootballFieldShape el={element} pxPerFt={pxPerFt} style={style} labelSide={labelSide} />
        </Group>
      );
    case "cricket-pitch":
      return (
        <Group {...commonGroupProps}>
          <CricketPitchShape el={element} pxPerFt={pxPerFt} style={style} />
        </Group>
      );
    case "basketball-court":
      return (
        <Group {...commonGroupProps}>
          {strokeOverride && (
            <BasketballCourtShape
              el={element}
              pxPerFt={pxPerFt}
              style={style}
              strokeOverride={strokeOverride}
            />
          )}
          <BasketballCourtShape el={element} pxPerFt={pxPerFt} style={style} labelSide={labelSide} />
          {isSelected && onSectionClick && (
            <SectionClickOverlays
              presets={HIGHLIGHT_PRESETS["basketball-court"] ?? []}
              courtW={element.width * pxPerFt}
              courtH={element.height * pxPerFt}
              onSectionClick={(preset) => onSectionClick(element, preset)}
            />
          )}
        </Group>
      );
    case "pickleball-court":
      return (
        <Group {...commonGroupProps}>
          {strokeOverride && (
            <PickleballCourtShape
              el={element}
              pxPerFt={pxPerFt}
              style={style}
              strokeOverride={strokeOverride}
            />
          )}
          <PickleballCourtShape el={element} pxPerFt={pxPerFt} style={style} labelSide={labelSide} />
          {isSelected && onSectionClick && (
            <SectionClickOverlays
              presets={HIGHLIGHT_PRESETS["pickleball-court"] ?? []}
              courtW={element.width * pxPerFt}
              courtH={element.height * pxPerFt}
              onSectionClick={(preset) => onSectionClick(element, preset)}
            />
          )}
        </Group>
      );
    case "generic-court":
      return (
        <Group {...commonGroupProps}>
          {strokeOverride && (
            <GenericCourtShape
              el={element}
              pxPerFt={pxPerFt}
              style={style}
              strokeOverride={strokeOverride}
            />
          )}
          <GenericCourtShape el={element} pxPerFt={pxPerFt} style={style} labelSide={labelSide} />
          {isSelected && onSectionClick && (
            <SectionClickOverlays
              presets={HIGHLIGHT_PRESETS[`generic-court-${element.sport}`] ?? []}
              courtW={element.width * pxPerFt}
              courtH={element.height * pxPerFt}
              onSectionClick={(preset) => onSectionClick(element, preset)}
            />
          )}
        </Group>
      );
    case "goal-post":
      return (
        <Group {...commonGroupProps}>
          <GoalPostShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "net":
      return (
        <Group {...commonGroupProps}>
          <NetShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "annotation":
      return (
        <Group {...commonGroupProps}>
          <AnnotationShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "custom-line":
      return (
        <Group {...commonGroupProps}>
          <CustomLineShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "custom-rect":
      return (
        <Group {...commonGroupProps}>
          <CustomRectShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "fence-rect":
      return (
        <Group {...commonGroupProps}>
          <FenceRectShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "dugout":
      return (
        <Group {...commonGroupProps}>
          <DugoutShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "basketball-hoop":
      return (
        <Group {...commonGroupProps}>
          <BasketballHoopShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "highlight-zone":
      return (
        <Group {...commonGroupProps}>
          <HighlightZoneShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "floodlight":
      return (
        <Group {...commonGroupProps}>
          <FloodlightShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "seating":
      return (
        <Group {...commonGroupProps}>
          <SeatingShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "scoreboard":
      return (
        <Group {...commonGroupProps}>
          <ScoreboardShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "sight-screen":
      return (
        <Group {...commonGroupProps}>
          <SightScreenShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "corner-flag":
      return (
        <Group {...commonGroupProps}>
          <CornerFlagShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "gate":
      return (
        <Group {...commonGroupProps}>
          <GateShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
    case "center-logo":
      return (
        <Group {...commonGroupProps}>
          <CenterLogoShape el={element} pxPerFt={pxPerFt} />
        </Group>
      );
  }
}

function applyScaleToDimensions(
  element: Element,
  scaleX: number,
  scaleY: number,
  patch: Partial<Element>
): void {
  // Bake transformer scale into the element's natural dimensions. Each
  // element type stores its size differently; this switch keeps the
  // mapping in one place so adding a new shape only touches this function.
  switch (element.type) {
    case "football-field":
    case "basketball-court":
    case "pickleball-court":
    case "generic-court":
    case "custom-rect":
    case "fence-rect":
    case "dugout":
    case "highlight-zone":
      (patch as Partial<typeof element>).width = element.width * scaleX;
      (patch as Partial<typeof element>).height = element.height * scaleY;
      break;
    case "seating":
      (patch as Partial<SeatingElement>).width = element.width * scaleX;
      (patch as Partial<SeatingElement>).depth = element.depth * scaleY;
      break;
    case "scoreboard":
    case "sight-screen":
    case "gate":
      (patch as Partial<ScoreboardElement | SightScreenElement | GateElement>).widthFt =
        element.widthFt * scaleX;
      (patch as Partial<ScoreboardElement | SightScreenElement | GateElement>).heightFt =
        element.heightFt * scaleY;
      break;
    case "center-logo":
      (patch as Partial<CenterLogoElement>).diameterFt =
        element.diameterFt * Math.max(scaleX, scaleY);
      break;
    case "floodlight":
      (patch as Partial<FloodlightElement>).poleHeightFt =
        element.poleHeightFt * Math.max(scaleX, scaleY);
      break;
    case "corner-flag":
      (patch as Partial<CornerFlagElement>).heightFt =
        (element.heightFt ?? 5) * Math.max(scaleX, scaleY);
      break;
    case "basketball-hoop":
      (patch as Partial<BasketballHoopElement>).backboardWidthFt =
        element.backboardWidthFt * scaleX;
      (patch as Partial<BasketballHoopElement>).poleHeightFt =
        element.poleHeightFt * scaleY;
      break;
    case "cricket-pitch":
      (patch as Partial<CricketPitchElement>).pitchLengthFt = element.pitchLengthFt * scaleX;
      (patch as Partial<CricketPitchElement>).pitchWidthFt = element.pitchWidthFt * scaleY;
      break;
    case "goal-post":
      (patch as Partial<GoalPostElement>).widthFt = element.widthFt * scaleX;
      (patch as Partial<GoalPostElement>).depthFt = element.depthFt * scaleY;
      break;
    case "net":
      (patch as Partial<NetElement>).widthFt = element.widthFt * scaleX;
      (patch as Partial<NetElement>).heightFt = element.heightFt * scaleY;
      break;
    case "custom-line":
      (patch as Partial<CustomLineElement>).lengthFt = element.lengthFt * scaleX;
      break;
    case "annotation":
      (patch as Partial<AnnotationElement>).fontSize = element.fontSize * Math.max(scaleX, scaleY);
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Shape renderers — one per element type
// ─────────────────────────────────────────────────────────────────────

// Perf: the court shapes are the heavy renderers — each emits dozens (fence:
// ~40 hatch lines, basketball: ~50 markings) of Konva primitives. Their props
// are a single element object + a few primitives; updateElement() keeps the
// object identity of every UNCHANGED element and preserves layout.style
// identity across element edits, so React.memo lets a select / drag-end /
// single-element edit skip regenerating the primitives for every OTHER court.
// Without this, any state change re-reconciled the whole canvas. The `...Base`
// impls are declared below (hoisted) and wrapped here.
const FootballFieldShape = memo(FootballFieldShapeBase);
const CricketPitchShape = memo(CricketPitchShapeBase);
const BasketballCourtShape = memo(BasketballCourtShapeBase);
const PickleballCourtShape = memo(PickleballCourtShapeBase);
const GenericCourtShape = memo(GenericCourtShapeBase);
const FenceRectShape = memo(FenceRectShapeBase);

// Sport-name label for a court — a small dark pill + white text above the
// court's top-left corner, with the court's size on a second line. Every court
// renders its own, so on a multi-sport (concentric) design each court is
// identifiable AND its dimensions are shown.
function CourtNameLabel({
  w,
  h,
  name,
  dims,
  side = "left",
}: {
  w: number;
  h: number;
  name: string;
  dims?: string;
  // Which top corner the label sits at. On overlaid same-size courts the
  // parent puts one court's label on the LEFT and the other on the RIGHT so
  // they don't collide.
  side?: "left" | "right";
}) {
  // Bumped the minimum so labels never render tiny/blurry on thin courts
  // (e.g. a cricket pitch, where the short side drives the size).
  const fs = Math.min(20, Math.max(12, Math.min(w, h) * 0.055));
  const dfs = fs * 0.85;
  const padX = fs * 0.55;
  const padY = fs * 0.3;
  const line1W = name.length * fs * 0.62;
  const line2W = dims ? dims.length * dfs * 0.6 : 0;
  const boxW = Math.max(line1W, line2W) + padX * 2;
  const boxH = fs + (dims ? dfs + 2 : 0) + padY * 2;
  const top = -h / 2 - boxH - 3;
  const boxX = side === "right" ? w / 2 - boxW : -w / 2;
  return (
    <>
      <Rect
        x={boxX}
        y={top}
        width={boxW}
        height={boxH}
        fill="rgba(15,23,42,0.85)"
        cornerRadius={3}
        listening={false}
      />
      <Text
        x={boxX + padX}
        y={top + padY}
        text={name}
        fontSize={fs}
        fontStyle="700"
        fill="#ffffff"
        letterSpacing={0.5}
        listening={false}
      />
      {dims && (
        <Text
          x={boxX + padX}
          y={top + padY + fs + 2}
          text={dims}
          fontSize={dfs}
          fill="#cbd5e1"
          listening={false}
        />
      )}
    </>
  );
}

// "92 × 49 ft" for a court element's playing size.
function courtDims(el: { width: number; height: number }): string {
  return `${Math.round(el.width)} × ${Math.round(el.height)} ft`;
}

// P2-01: on-canvas colour key for multi-sport plots. Anchored by its BOTTOM
// so it grows upward from the plot's bottom-left corner and never collides
// with the top court labels. Each row is a colour swatch + the sport name.
function CourtLegend({
  entries,
  x,
  bottom,
}: {
  entries: Array<{ sport: Sport; label: string; color: string }>;
  x: number;
  bottom: number;
}) {
  const rowH = 18;
  const padX = 10;
  const padY = 8;
  const fs = 12;
  const swatchW = 22;
  const swatchH = 4;
  const boxW =
    padX * 2 +
    swatchW +
    8 +
    Math.max(60, ...entries.map((e) => e.label.length * fs * 0.6));
  const boxH = padY * 2 + entries.length * rowH;
  const top = bottom - boxH;
  return (
    <Group listening={false}>
      <Rect
        x={x}
        y={top}
        width={boxW}
        height={boxH}
        fill="rgba(255,255,255,0.92)"
        cornerRadius={5}
        shadowColor="rgba(0,0,0,0.25)"
        shadowBlur={6}
        shadowOffsetY={2}
      />
      {entries.map((e, i) => {
        const cy = top + padY + i * rowH + rowH / 2;
        return (
          <Group key={e.sport}>
            {/* Colour swatch — a thick line, matching the on-court marking. */}
            <Rect
              x={x + padX}
              y={cy - swatchH / 2}
              width={swatchW}
              height={swatchH}
              cornerRadius={swatchH / 2}
              fill={e.color}
              stroke="#94a3b8"
              strokeWidth={0.5}
            />
            <Text
              x={x + padX + swatchW + 8}
              y={cy - fs / 2}
              text={e.label}
              fontSize={fs}
              fontStyle="600"
              fill="#0f172a"
            />
          </Group>
        );
      })}
    </Group>
  );
}

function FootballFieldShapeBase({
  el,
  pxPerFt,
  style,
  labelSide,
}: {
  el: FootballFieldElement;
  pxPerFt: number;
  style: CourtLayout["style"];
  labelSide?: "left" | "right";
}) {
  const w = el.width * pxPerFt;
  const h = el.height * pxPerFt;
  const props = aSideProps(el.aSide);
  const grassColor = el.grassColor ?? style.grassColor;
  const lineColor = el.lineColor ?? style.lineColor;
  const lineWidth = Math.max(1.2, w * 0.004);

  const pbW = w * props.penaltyBoxWidthRatio;
  const pbH = h * props.penaltyBoxHeightRatio;
  const gaW = w * props.goalAreaWidthRatio;
  const gaH = h * props.goalAreaHeightRatio;
  const centerR = Math.min(w, h) * props.centerCircleRadiusRatio;
  const goalW = h * props.goalWidthRatio;
  const goalH = Math.min(w * 0.04, 6 * pxPerFt);
  const cornerR = Math.min(w, h) * 0.02;
  const penaltySpotOffset = pbW * 0.55;

  // Mowed stripes — 10 vertical bands alternating between two greens.
  const stripeCount = 10;
  const stripeW = w / stripeCount;

  // When a real plot surface is chosen (turf / tile / etc.) the PLOT
  // already paints the surface (and its own turf stripes). Drawing the
  // field's own grass on top produced a "two layers" look with
  // mismatched stripe directions. So skip the field grass fill when a
  // surface is set — let the plot surface show through, markings on
  // top. On a "plain" plot the field draws its own grass as before.
  //
  // EXCEPTION: when a run-off colour is set, the plot fill becomes that solid
  // colour (stripes skipped). If the pitch stayed transparent it would show
  // the run-off colour too — so the pitch draws its own turf, keeping the
  // playing area green while ONLY the run-off ring takes the colour.
  const runOffColored =
    !!style.runOffColorOverride && style.runOffColorOverride !== "none";
  const drawOwnGrass = style.surface === "plain" || runOffColored;

  return (
    <>
      {/* Grass — only when the plot has no real surface finish */}
      {drawOwnGrass &&
        (style.grassStripes ? (
          Array.from({ length: stripeCount }).map((_, i) => (
            <Rect
              key={i}
              x={-w / 2 + i * stripeW}
              y={-h / 2}
              width={stripeW}
              height={h}
              // P1-04: alternate ABOVE and BELOW the base green (was a one-sided
              // 8% darken) so the mow bands read clearly instead of near-flat.
              fill={i % 2 ? lighten(grassColor, 0.08) : darken(grassColor, 0.15)}
            />
          ))
        ) : (
          <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill={grassColor} />
        ))}

      {/* Outer boundary */}
      <Rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />

      {/* Halfway line */}
      <Line points={[0, -h / 2, 0, h / 2]} stroke={lineColor} strokeWidth={lineWidth} />

      {/* Center circle + spot */}
      <Circle x={0} y={0} radius={centerR} stroke={lineColor} strokeWidth={lineWidth} />
      <Circle x={0} y={0} radius={Math.max(2, lineWidth * 1.3)} fill={lineColor} />

      {/* Penalty boxes */}
      <Rect
        x={-w / 2}
        y={-pbH / 2}
        width={pbW}
        height={pbH}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />
      <Rect
        x={w / 2 - pbW}
        y={-pbH / 2}
        width={pbW}
        height={pbH}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />

      {/* Goal areas */}
      <Rect
        x={-w / 2}
        y={-gaH / 2}
        width={gaW}
        height={gaH}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />
      <Rect
        x={w / 2 - gaW}
        y={-gaH / 2}
        width={gaW}
        height={gaH}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />

      {/* Penalty spots */}
      <Circle
        x={-w / 2 + penaltySpotOffset}
        y={0}
        radius={Math.max(2, lineWidth * 1.3)}
        fill={lineColor}
      />
      <Circle
        x={w / 2 - penaltySpotOffset}
        y={0}
        radius={Math.max(2, lineWidth * 1.3)}
        fill={lineColor}
      />

      {/* Penalty arcs (just outside box, facing midfield) */}
      <Arc
        x={-w / 2 + penaltySpotOffset}
        y={0}
        innerRadius={centerR * 0.85}
        outerRadius={centerR * 0.85}
        angle={84}
        rotation={-42}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />
      <Arc
        x={w / 2 - penaltySpotOffset}
        y={0}
        innerRadius={centerR * 0.85}
        outerRadius={centerR * 0.85}
        angle={84}
        rotation={138}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />

      {/* Corner arcs */}
      <Arc
        x={-w / 2}
        y={-h / 2}
        innerRadius={cornerR}
        outerRadius={cornerR}
        angle={90}
        rotation={0}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />
      <Arc
        x={w / 2}
        y={-h / 2}
        innerRadius={cornerR}
        outerRadius={cornerR}
        angle={90}
        rotation={90}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />
      <Arc
        x={-w / 2}
        y={h / 2}
        innerRadius={cornerR}
        outerRadius={cornerR}
        angle={90}
        rotation={270}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />
      <Arc
        x={w / 2}
        y={h / 2}
        innerRadius={cornerR}
        outerRadius={cornerR}
        angle={90}
        rotation={180}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />

      {/* Goal mouth fills (visualize where the goal sits) */}
      <Rect
        x={-w / 2 - goalH}
        y={-goalW / 2}
        width={goalH}
        height={goalW}
        fill="#e2e8f0"
        stroke="#0f172a"
        strokeWidth={1}
      />
      <Rect
        x={w / 2}
        y={-goalW / 2}
        width={goalH}
        height={goalW}
        fill="#e2e8f0"
        stroke="#0f172a"
        strokeWidth={1}
      />
      <CourtNameLabel w={w} h={h} name="FOOTBALL" dims={courtDims(el)} side={labelSide} />
    </>
  );
}

function CricketPitchShapeBase({
  el,
  pxPerFt,
  style,
}: {
  el: CricketPitchElement;
  pxPerFt: number;
  style: CourtLayout["style"];
}) {
  const w = el.pitchLengthFt * pxPerFt;
  const h = el.pitchWidthFt * pxPerFt;
  const fill = el.pitchColor ?? style.cricketPitchColor;
  const mark = el.markingColor ?? "#fff5e6";
  // Crease distance from each end of the pitch (popping crease) in ft.
  // ~4 ft from the stumps at each end (regulation).
  const popDistPx = Math.min(w * 0.12, 5 * pxPerFt);
  return (
    <>
      <Rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        fill={fill}
        stroke={darken(fill, 0.25)}
        strokeWidth={1.5}
        cornerRadius={1}
      />
      {/* Popping crease lines (full pitch width at each end) */}
      <Line points={[-w / 2 + popDistPx, -h / 2, -w / 2 + popDistPx, h / 2]} stroke={mark} strokeWidth={1.5} />
      <Line points={[w / 2 - popDistPx, -h / 2, w / 2 - popDistPx, h / 2]} stroke={mark} strokeWidth={1.5} />
      {/* Return crease (short stubs inside the pitch) */}
      <Line points={[-w / 2 + popDistPx, -h / 4, -w / 2 + popDistPx, -h / 2 + h * 0.18]} stroke={mark} strokeWidth={1.5} />
      <Line points={[w / 2 - popDistPx, -h / 4, w / 2 - popDistPx, -h / 2 + h * 0.18]} stroke={mark} strokeWidth={1.5} />
      {/* Wickets (3 stumps each end) */}
      {[
        -w / 2 + popDistPx * 1.6,
        w / 2 - popDistPx * 1.6,
      ].map((sx, idx) => (
        <Group key={idx} x={sx} y={0}>
          {[-3, 0, 3].map((off, i) => (
            <Rect key={i} x={off - 0.7} y={-h * 0.18} width={1.4} height={h * 0.36} fill={mark} />
          ))}
        </Group>
      ))}
      {/* Size label — cricket has pitchLengthFt/pitchWidthFt (not width/height),
          so the dims string is built from those directly. */}
      <CourtNameLabel
        w={w}
        h={h}
        name="CRICKET PITCH"
        dims={`${Math.round(el.pitchLengthFt)} × ${Math.round(el.pitchWidthFt)} ft (${(el.pitchLengthFt * 0.3048).toFixed(1)} × ${(el.pitchWidthFt * 0.3048).toFixed(1)} m)`}
      />
    </>
  );
}

// One-click section highlighting. When a court is selected, dashed
// amber outlines appear over its named regions (basketball key, tennis
// service box, badminton service courts, volleyball attack zone,
// pickleball kitchen, etc.). Hovering tints the region; clicking drops
// a HighlightZoneElement at exactly that location so sales doesn't
// have to drag a blank rectangle around. Matches the "click a shape,
// fill with colour" mental model the user asked for.
function SectionClickOverlays({
  presets,
  courtW,
  courtH,
  onSectionClick,
}: {
  presets: HighlightSectionPreset[];
  courtW: number;
  courtH: number;
  onSectionClick: (preset: HighlightSectionPreset) => void;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  if (presets.length === 0) return null;
  // Konva paints in array order, so the LAST item ends up on top and
  // catches pointer events first. Sort smaller sections to the end so
  // clicking on e.g. the key doesn't accidentally trigger a bigger
  // overlay that contains it.
  const sortedPresets = [...presets].sort(
    (a, b) => b.wFrac * b.hFrac - a.wFrac * a.hFrac,
  );
  return (
    <>
      {sortedPresets.map((p) => {
        const w = p.wFrac * courtW;
        const h = p.hFrac * courtH;
        const shape = p.shape ?? "rect";
        const hovered = hoveredKey === p.key;
        const commonProps = {
          // Named so the PNG export can hide these editor-only click targets
          // before stage.toDataURL() — otherwise the dashed amber section
          // overlays get baked into the customer-facing image.
          name: "section-overlay",
          fill: hovered ? "rgba(255,193,7,0.30)" : "rgba(255,193,7,0.04)",
          stroke: hovered ? "#f59e0b" : "rgba(251,191,36,0.6)",
          strokeWidth: hovered ? 2 : 1,
          dash: hovered ? [] : [4, 4],
          listening: true,
          onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => {
            setHoveredKey(p.key);
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = "pointer";
          },
          onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => {
            setHoveredKey(null);
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = "default";
          },
          onClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
            e.cancelBubble = true;
            onSectionClick(p);
          },
          onTap: (e: Konva.KonvaEventObject<TouchEvent>) => {
            e.cancelBubble = true;
            onSectionClick(p);
          },
        };
        // Arc-shaped overlays render via Konva Path positioned AT the
        // arc centre (cxFrac / cyFrac). Rect overlays render from
        // top-left (shift by -w/2 / -h/2).
        if (shape === "arc-right" || shape === "arc-left") {
          const cx = p.cxFrac * courtW;
          const cy = p.cyFrac * courtH;
          const data =
            shape === "arc-right"
              ? arcRightPath(w, h)
              : arcLeftPath(w, h);
          return <Path key={p.key} x={cx} y={cy} data={data} {...commonProps} />;
        }
        // Preset centre is (cxFrac * courtW, cyFrac * courtH) in court
        // local coords. Konva Rect places from top-left, so shift by
        // -w/2, -h/2 to centre on the preset's point.
        const x = p.cxFrac * courtW - w / 2;
        const y = p.cyFrac * courtH - h / 2;
        return (
          <Rect
            key={p.key}
            x={x}
            y={y}
            width={w}
            height={h}
            {...commonProps}
          />
        );
      })}
    </>
  );
}

function BasketballCourtShapeBase({
  el,
  pxPerFt,
  style,
  labelSide,
  strokeOverride,
}: {
  el: BasketballCourtElement;
  pxPerFt: number;
  style: CourtLayout["style"];
  labelSide?: "left" | "right";
  // P2-01: halo pass — draw strokes only, in this colour, `extraPx` wider.
  strokeOverride?: { color: string; extraPx: number };
}) {
  const w = el.width * pxPerFt;
  const h = el.height * pxPerFt;
  // When the plot has a tiled surface (PPE tile), keep the court fill
  // TRANSPARENT so the tile pattern + measurement grid (which
  // represents real tile edges) show straight through the playing
  // area. Sales asked for grid lines on PPE-tile courts — those grid
  // squares are the physical tiles.
  //
  // For continuous surfaces (acrylic, turf, PVC), when style.runOffTone
  // is on, PlotSurface darkens the plot fill so the run-off zone
  // reads distinct. In that case the court's playing area rectangle
  // takes the FULL (undarkened) surface colour so it stays lighter
  // than the surrounding run-off ring.
  const runOff = style.runOffTone && style.runOffTone !== "off";
  const tiled = isTiledSurface(style.surface);
  // A surface colour override paints the PLAYING area its full (undarkened)
  // colour; the plot base under it takes the darkened run-off shade, so the
  // playing-area vs run-off split shows for this sport too (not just
  // football/cricket). Per-element surfaceColor still wins for multi-sport
  // zone colours.
  const fill =
    el.surfaceColor ??
    style.surfaceColorOverride ??
    (tiled
      ? "transparent"
      : runOff && style.surface !== "plain"
        ? SURFACE_SOLID_COLOR[style.surface] ?? style.basketballSurfaceColor
        : style.surface !== "plain"
          ? "transparent"
          : style.basketballSurfaceColor);
  const line = strokeOverride ? strokeOverride.color : el.lineColor ?? "#fff5e6";
  const lineWidth =
    Math.max(1, Math.min(w, h) * 0.005) + (strokeOverride?.extraPx ?? 0);

  // Ratios below are FIBA regulation — measured as fractions of the
  // 28 × 15 m playing area. Because the court element is now sized to
  // the playing area (not the full plot), these ratios render at real
  // scale.
  //
  //   key       = 4.90 m × 4.90 m  →  0.175 w × 0.327 h
  //   ft circle = 1.80 m radius     →  0.120 h
  //   3-pt arc  = 6.75 m radius     →  0.450 h  (from basket centre)
  //   basket    = 1.575 m from baseline → 0.056 w
  //   backboard = 1.20 m from baseline, 1.80 m wide → 0.043 w, 0.120 h
  //   no-charge = 1.25 m radius from basket → 0.083 h
  //   corner 3  = straight lines 0.90 m from sideline → 0.060 h
  const keyW = w * 0.175;
  const keyH = h * 0.327;
  const ftR = h * 0.12;
  const centerR = h * 0.12;
  const threeR = h * 0.45;
  const basketOffset = w * 0.056;
  const backboardOffset = w * 0.043;
  const backboardHalfW = h * 0.06;
  const noChargeR = h * 0.083;
  const cornerOffset = h * 0.06;
  // Straight portion of the 3-pt line: from baseline (dir*w/2) inward
  // to where it meets the arc at y = h/2 - cornerOffset. Distance:
  // sqrt(threeR² − (h/2 − cornerOffset)²) from the basket in the
  // x direction.
  const cornerY = h / 2 - cornerOffset;
  const cornerArcDx = Math.sqrt(Math.max(0, threeR * threeR - cornerY * cornerY));

  return (
    <>
      {!strokeOverride && (
        <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill={fill} />
      )}
      {/* V1 per-area highlight fill — jump-ball / centre circle, behind the
          markings so the lines stay legible. */}
      {!strokeOverride && !el.halfCourt && style.basketballCircleColor && (
        <Circle
          x={0}
          y={0}
          radius={centerR}
          fill={style.basketballCircleColor}
          opacity={0.55}
        />
      )}
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} stroke={line} strokeWidth={lineWidth} />
      {!el.halfCourt && (
        <Line points={[0, -h / 2, 0, h / 2]} stroke={line} strokeWidth={lineWidth} />
      )}
      {!el.halfCourt && (
        <Circle x={0} y={0} radius={centerR} stroke={line} strokeWidth={lineWidth} />
      )}

      {/* Two ends — key + free throw circle + backboard + basket + no-charge + 3-pt line */}
      {(el.halfCourt ? [1] : [-1, 1]).map((dir) => {
        // Basket position (centre of the rim) — 1.575 m inside baseline.
        const baselineX = (dir * w) / 2;
        const basketX = baselineX - dir * basketOffset;
        // Free-throw circle centre — at the top of the key (5.80 m from baseline).
        const ftLineX = baselineX - dir * keyW;
        // Backboard face — 1.20 m from baseline (in front of basket).
        const backboardX = baselineX - dir * backboardOffset;
        // Where the corner straight meets the arc — basketX ± cornerArcDx.
        // Sign: for the LEFT baseline (dir=-1), corner segment runs right
        // (positive dx from basket, since arc's inward side is +x). For
        // RIGHT (dir=1), it runs left (negative dx).
        const cornerArcX = basketX - dir * cornerArcDx;

        // Angle of the corner arc endpoint (from basket, measured from
        // positive x-axis on the LEFT side, negative x-axis on RIGHT).
        // atan2(cornerY, cornerArcDx) gives the angle in radians.
        const cornerAngleDeg = (Math.atan2(cornerY, cornerArcDx) * 180) / Math.PI;
        // Konva Arc sweeps CLOCKWISE from `rotation` by `angle`. For
        // the LEFT half, the arc opens to the right so rotation should
        // start at the bottom endpoint and sweep upward through the
        // rightmost point back to the top endpoint. For the RIGHT half
        // it mirrors.
        const arcRotation = dir < 0 ? -cornerAngleDeg : 180 - cornerAngleDeg;
        const arcAngle = 2 * cornerAngleDeg;

        return (
          <Group key={dir}>
            {/* V1 per-area highlight fills — drawn largest-first, BEHIND the
                markings. The 3-point area is the FULL region bounded by the
                3-point line: the two corner straights (from the baseline) + the
                arc. Tracing that closed polygon fills the corners behind the
                hoop too (a plain pie sector left them uncovered). */}
            {!strokeOverride && style.basketball3ptColor && (
              <Line
                points={(() => {
                  const N = 24;
                  const arc: number[] = [];
                  let yStart = 0;
                  let yEnd = 0;
                  for (let k = 0; k <= N; k++) {
                    const a =
                      ((arcRotation + (arcAngle * k) / N) * Math.PI) / 180;
                    const px = basketX + threeR * Math.cos(a);
                    const py = threeR * Math.sin(a);
                    if (k === 0) yStart = py;
                    if (k === N) yEnd = py;
                    arc.push(px, py);
                  }
                  // baseline corner → arc → baseline corner, closed along the
                  // baseline.
                  return [baselineX, yStart, ...arc, baselineX, yEnd];
                })()}
                closed
                fill={style.basketball3ptColor}
                opacity={0.55}
              />
            )}
            {!strokeOverride && style.basketballKeyColor && (
              <Rect
                x={dir < 0 ? baselineX : baselineX - keyW}
                y={-keyH / 2}
                width={keyW}
                height={keyH}
                fill={style.basketballKeyColor}
                opacity={0.55}
              />
            )}
            {/* Key (paint) — 4.90 × 4.90 m rectangle butted against the baseline */}
            <Rect
              x={dir < 0 ? baselineX : baselineX - keyW}
              y={-keyH / 2}
              width={keyW}
              height={keyH}
              stroke={line}
              strokeWidth={lineWidth}
            />

            {/* Free-throw circle — centred on the top of the key */}
            <Circle
              x={ftLineX}
              y={0}
              radius={ftR}
              stroke={line}
              strokeWidth={lineWidth}
            />

            {/* Backboard — 1.80 m wide, drawn 1.20 m from baseline */}
            <Line
              points={[
                backboardX,
                -backboardHalfW,
                backboardX,
                backboardHalfW,
              ]}
              stroke={line}
              strokeWidth={lineWidth * 2}
            />

            {/* Basket rim — small circle at the basket centre */}
            <Circle
              x={basketX}
              y={0}
              radius={Math.max(2, h * 0.015)}
              stroke={line}
              strokeWidth={lineWidth}
            />

            {/* No-charge semi-circle — 1.25 m radius around basket, open toward
                the baseline (semicircle facing INTO the court) */}
            <Arc
              x={basketX}
              y={0}
              innerRadius={noChargeR}
              outerRadius={noChargeR}
              angle={180}
              rotation={dir < 0 ? -90 : 90}
              stroke={line}
              strokeWidth={lineWidth}
            />

            {/* Corner 3-point straight segments — from baseline at
                y = ±(h/2 − 0.9 m) inward to where they meet the arc */}
            <Line
              points={[baselineX, cornerY, cornerArcX, cornerY]}
              stroke={line}
              strokeWidth={lineWidth}
            />
            <Line
              points={[baselineX, -cornerY, cornerArcX, -cornerY]}
              stroke={line}
              strokeWidth={lineWidth}
            />

            {/* 3-point arc — from top corner endpoint clockwise through the
                far side of the arc back to the bottom corner endpoint */}
            <Arc
              x={basketX}
              y={0}
              innerRadius={threeR}
              outerRadius={threeR}
              angle={arcAngle}
              rotation={arcRotation}
              stroke={line}
              strokeWidth={lineWidth}
            />
          </Group>
        );
      })}
      {!strokeOverride && (
        <CourtNameLabel w={w} h={h} name="BASKETBALL" dims={courtDims(el)} side={labelSide} />
      )}
    </>
  );
}

function PickleballCourtShapeBase({
  el,
  pxPerFt,
  style,
  labelSide,
  strokeOverride,
}: {
  el: PickleballCourtElement;
  pxPerFt: number;
  style: CourtLayout["style"];
  labelSide?: "left" | "right";
  // P2-01: halo pass — draw strokes only, in this colour, `extraPx` wider.
  strokeOverride?: { color: string; extraPx: number };
}) {
  const w = el.width * pxPerFt;
  const h = el.height * pxPerFt;
  // Same run-off / override logic as the other courts: an override (or the
  // full surface colour when run-off is on) paints the playing area so the
  // darker run-off ring around it reads distinct.
  const runOff = style.runOffTone && style.runOffTone !== "off";
  const fill =
    el.surfaceColor ??
    style.surfaceColorOverride ??
    (isTiledSurface(style.surface)
      ? "transparent"
      : runOff && style.surface !== "plain"
        ? SURFACE_SOLID_COLOR[style.surface] ?? style.pickleballSurfaceColor
        : style.surface !== "plain"
          ? "transparent"
          : style.pickleballSurfaceColor);
  const line = strokeOverride ? strokeOverride.color : el.lineColor ?? "#ffffff";
  const lineWidth =
    Math.max(1, Math.min(w, h) * 0.006) + (strokeOverride?.extraPx ?? 0);
  // Kitchen / non-volley zone — 7 ft from net on each side.
  const kitchenW = w * 0.16;
  return (
    <>
      {!strokeOverride && (
        <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill={fill} />
      )}
      {/* Kitchen / non-volley zone highlight — the central band around the
          net. Uses the chosen colour, else the per-sport preset. Translucent
          so the markings stay visible on top. */}
      {!strokeOverride &&
        style.kitchenColor !== "none" &&
        (style.kitchenColor ?? KITCHEN_DEFAULT_COLOR.pickleball) && (
          <Rect
            x={-kitchenW}
            y={-h / 2}
            width={kitchenW * 2}
            height={h}
            fill={style.kitchenColor ?? KITCHEN_DEFAULT_COLOR.pickleball}
            opacity={0.55}
            listening={false}
          />
        )}
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} stroke={line} strokeWidth={lineWidth} />
      {/* Net line (center) */}
      <Line points={[0, -h / 2, 0, h / 2]} stroke={line} strokeWidth={lineWidth * 1.2} />
      {/* Kitchen boundaries */}
      <Line points={[-kitchenW, -h / 2, -kitchenW, h / 2]} stroke={line} strokeWidth={lineWidth} />
      <Line points={[kitchenW, -h / 2, kitchenW, h / 2]} stroke={line} strokeWidth={lineWidth} />
      {/* Service court divider (between baseline and kitchen) */}
      <Line points={[-w / 2, 0, -kitchenW, 0]} stroke={line} strokeWidth={lineWidth} />
      <Line points={[kitchenW, 0, w / 2, 0]} stroke={line} strokeWidth={lineWidth} />
      {!strokeOverride && (
        <CourtNameLabel w={w} h={h} name="PICKLEBALL" dims={courtDims(el)} side={labelSide} />
      )}
    </>
  );
}

function GenericCourtShapeBase({
  el,
  pxPerFt,
  style,
  labelSide,
  strokeOverride,
}: {
  el: GenericCourtElement;
  pxPerFt: number;
  style: CourtLayout["style"];
  labelSide?: "left" | "right";
  // P2-01: halo pass — draw strokes only, in this colour, `extraPx` wider.
  strokeOverride?: { color: string; extraPx: number };
}) {
  const w = el.width * pxPerFt;
  const h = el.height * pxPerFt;
  // Sport-appropriate default surface colour + line colour.
  const defaultFill =
    el.sport === "tennis"
      ? "#5a8a6c"
      : el.sport === "badminton"
        ? "#3f6f4a"
        : el.sport === "volleyball"
          ? "#c97a4b"
          : "#5a8a6c";
  // Same run-off / override logic as the other courts so the playing-area
  // vs run-off split shows for tennis / badminton / volleyball too.
  const runOff = style.runOffTone && style.runOffTone !== "off";
  const fill =
    el.surfaceColor ??
    style.surfaceColorOverride ??
    (isTiledSurface(style.surface)
      ? "transparent"
      : runOff && style.surface !== "plain"
        ? SURFACE_SOLID_COLOR[style.surface] ?? defaultFill
        : style.surface !== "plain"
          ? "transparent"
          : defaultFill);
  const line = strokeOverride ? strokeOverride.color : el.lineColor ?? "#ffffff";
  const lineWidth =
    Math.max(1, Math.min(w, h) * 0.005) + (strokeOverride?.extraPx ?? 0);

  return (
    <>
      {!strokeOverride && (
        <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill={fill} />
      )}
      {/* V1: the kitchen / non-volley filled zone was removed for tennis /
          badminton / volleyball — only pickleball keeps a kitchen fill. The
          sport's service / attack LINES below still render, so volleyball now
          reads as a whole-court colour + run-off. */}
      {/* Outer boundary */}
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} stroke={line} strokeWidth={lineWidth} />
      {/* Sport-specific line pattern */}
      {el.sport === "tennis" && (
        <TennisMarkings w={w} h={h} line={line} lineWidth={lineWidth} />
      )}
      {el.sport === "badminton" && (
        <BadmintonMarkings w={w} h={h} line={line} lineWidth={lineWidth} />
      )}
      {el.sport === "volleyball" && (
        <VolleyballMarkings w={w} h={h} line={line} lineWidth={lineWidth} />
      )}
      {el.sport !== "tennis" &&
        el.sport !== "badminton" &&
        el.sport !== "volleyball" && (
          <Line
            points={[0, -h / 2, 0, h / 2]}
            stroke={line}
            strokeWidth={lineWidth}
          />
        )}
      {!strokeOverride && (
        <CourtNameLabel w={w} h={h} name={el.sport.toUpperCase()} dims={courtDims(el)} side={labelSide} />
      )}
    </>
  );
}

// Tennis court markings: net line (centre, along width), doubles +
// singles sidelines, service courts + service line, T-shape at each end.
function TennisMarkings({ w, h, line, lineWidth }: { w: number; h: number; line: string; lineWidth: number }) {
  // Court proportions (from 78 × 36 regulation): singles sideline is
  // 4.5 ft in from doubles (27 ft wide singles vs 36 ft doubles).
  // Service line is 21 ft from net on each side.
  const singlesInset = (4.5 / 36) * h;
  const serviceLineOffset = (21 / 78) * w;
  return (
    <>
      {/* Net line — vertical centre, thicker */}
      <Line points={[0, -h / 2, 0, h / 2]} stroke={line} strokeWidth={lineWidth * 1.4} />
      {/* Singles sidelines */}
      <Line points={[-w / 2, -h / 2 + singlesInset, w / 2, -h / 2 + singlesInset]} stroke={line} strokeWidth={lineWidth} />
      <Line points={[-w / 2, h / 2 - singlesInset, w / 2, h / 2 - singlesInset]} stroke={line} strokeWidth={lineWidth} />
      {/* Service lines (both sides of net) */}
      <Line points={[-serviceLineOffset, -h / 2 + singlesInset, -serviceLineOffset, h / 2 - singlesInset]} stroke={line} strokeWidth={lineWidth} />
      <Line points={[serviceLineOffset, -h / 2 + singlesInset, serviceLineOffset, h / 2 - singlesInset]} stroke={line} strokeWidth={lineWidth} />
      {/* Centre service line (between service line and net) */}
      <Line points={[-serviceLineOffset, 0, serviceLineOffset, 0]} stroke={line} strokeWidth={lineWidth} />
      {/* Centre mark on baseline */}
      <Line points={[-w / 2, 0, -w / 2 + w * 0.02, 0]} stroke={line} strokeWidth={lineWidth} />
      <Line points={[w / 2 - w * 0.02, 0, w / 2, 0]} stroke={line} strokeWidth={lineWidth} />
    </>
  );
}

// Badminton court markings: net line (centre), doubles + singles side +
// back lines, short + long service lines, centre service line.
function BadmintonMarkings({ w, h, line, lineWidth }: { w: number; h: number; line: string; lineWidth: number }) {
  // From regulation 44 × 20: singles sideline 1.5 ft in from doubles,
  // short service line 6.5 ft from net, long service line for doubles
  // 2.5 ft from back boundary.
  const singlesInset = (1.5 / 20) * h;
  const shortServiceOffset = (6.5 / 44) * w;
  const longServiceInset = (2.5 / 44) * w;
  return (
    <>
      {/* Net line */}
      <Line points={[0, -h / 2, 0, h / 2]} stroke={line} strokeWidth={lineWidth * 1.4} />
      {/* Singles sidelines */}
      <Line points={[-w / 2, -h / 2 + singlesInset, w / 2, -h / 2 + singlesInset]} stroke={line} strokeWidth={lineWidth} />
      <Line points={[-w / 2, h / 2 - singlesInset, w / 2, h / 2 - singlesInset]} stroke={line} strokeWidth={lineWidth} />
      {/* Short service lines */}
      <Line points={[-shortServiceOffset, -h / 2, -shortServiceOffset, h / 2]} stroke={line} strokeWidth={lineWidth} />
      <Line points={[shortServiceOffset, -h / 2, shortServiceOffset, h / 2]} stroke={line} strokeWidth={lineWidth} />
      {/* Long service (doubles) — inset from back boundary */}
      <Line points={[-w / 2 + longServiceInset, -h / 2, -w / 2 + longServiceInset, h / 2]} stroke={line} strokeWidth={lineWidth} />
      <Line points={[w / 2 - longServiceInset, -h / 2, w / 2 - longServiceInset, h / 2]} stroke={line} strokeWidth={lineWidth} />
      {/* Centre service line (between short-service and back-boundary) */}
      <Line points={[-shortServiceOffset, 0, -w / 2, 0]} stroke={line} strokeWidth={lineWidth} />
      <Line points={[shortServiceOffset, 0, w / 2, 0]} stroke={line} strokeWidth={lineWidth} />
    </>
  );
}

// Volleyball court markings: net line, attack lines (10 ft from net on
// each side).
function VolleyballMarkings({ w, h, line, lineWidth }: { w: number; h: number; line: string; lineWidth: number }) {
  // From regulation 59 × 30: attack line 10 ft from centre net.
  const attackOffset = (10 / 59) * w;
  return (
    <>
      {/* Net line — thicker */}
      <Line points={[0, -h / 2, 0, h / 2]} stroke={line} strokeWidth={lineWidth * 1.6} />
      {/* Attack lines each side */}
      <Line points={[-attackOffset, -h / 2, -attackOffset, h / 2]} stroke={line} strokeWidth={lineWidth} />
      <Line points={[attackOffset, -h / 2, attackOffset, h / 2]} stroke={line} strokeWidth={lineWidth} />
    </>
  );
}

function GoalPostShape({ el, pxPerFt }: { el: GoalPostElement; pxPerFt: number }) {
  const w = el.widthFt * pxPerFt;
  const d = el.depthFt * pxPerFt;
  const color = el.color ?? "#f0f0f0";
  return (
    <>
      <Rect
        x={-w / 2}
        y={-d}
        width={w}
        height={d}
        fill="rgba(220,220,220,0.35)"
        stroke="#0f172a"
        strokeWidth={1.5}
      />
      <Rect x={-w / 2 - 2} y={-3} width={4} height={6} fill="#0f172a" />
      <Rect x={w / 2 - 2} y={-3} width={4} height={6} fill="#0f172a" />
      <Rect x={-w / 2} y={-d - 1} width={w} height={2} fill="#0f172a" />
    </>
  );
}

function NetShape({ el, pxPerFt }: { el: NetElement; pxPerFt: number }) {
  const w = el.widthFt * pxPerFt;
  const color = el.color ?? "#0f172a";
  return (
    <>
      <Line points={[-w / 2, 0, w / 2, 0]} stroke={color} strokeWidth={2} />
      <Rect x={-w / 2 - 2} y={-4} width={4} height={8} fill={color} />
      <Rect x={w / 2 - 2} y={-4} width={4} height={8} fill={color} />
    </>
  );
}

function AnnotationShape({ el, pxPerFt }: { el: AnnotationElement; pxPerFt: number }) {
  const fontSizePx = Math.max(10, el.fontSize * pxPerFt);
  // Estimate text dimensions for the background pill.
  const approxWidth = el.text.length * fontSizePx * 0.6 + 12;
  return (
    <>
      {el.background && (
        <Rect
          x={-approxWidth / 2}
          y={-fontSizePx * 0.75}
          width={approxWidth}
          height={fontSizePx * 1.5}
          fill={el.background}
          cornerRadius={fontSizePx * 0.3}
        />
      )}
      <Text
        text={el.text}
        fontSize={fontSizePx}
        fontFamily="system-ui, -apple-system, sans-serif"
        fontStyle="500"
        fill={el.color ?? "#0f172a"}
        align={el.align ?? "center"}
        x={-approxWidth / 2}
        y={-fontSizePx * 0.55}
        width={approxWidth}
      />
    </>
  );
}

function CustomLineShape({ el, pxPerFt }: { el: CustomLineElement; pxPerFt: number }) {
  const len = el.lengthFt * pxPerFt;
  const color = el.color ?? "#0f172a";
  const dash = el.dashed ? [8, 6] : undefined;
  const headSize = Math.max(6, el.thickness * 3);
  return (
    <>
      <Line
        points={[-len / 2, 0, len / 2, 0]}
        stroke={color}
        strokeWidth={el.thickness}
        dash={dash}
        lineCap="round"
      />
      {(el.arrow === "end" || el.arrow === "both") && (
        <Line
          points={[len / 2, 0, len / 2 - headSize, -headSize / 2, len / 2 - headSize, headSize / 2]}
          closed
          fill={color}
          lineJoin="round"
        />
      )}
      {el.arrow === "both" && (
        <Line
          points={[-len / 2, 0, -len / 2 + headSize, -headSize / 2, -len / 2 + headSize, headSize / 2]}
          closed
          fill={color}
          lineJoin="round"
        />
      )}
    </>
  );
}

function CustomRectShape({ el, pxPerFt }: { el: CustomRectElement; pxPerFt: number }) {
  const w = el.width * pxPerFt;
  const h = el.height * pxPerFt;
  return (
    <Rect
      x={-w / 2}
      y={-h / 2}
      width={w}
      height={h}
      fill={el.fill ?? "rgba(15,23,42,0.08)"}
      stroke={el.stroke ?? "#0f172a"}
      strokeWidth={el.strokeWidth ?? 2}
    />
  );
}

// SVG paths for arc-shaped highlight zones. Origin at the arc CENTRE
// (basket location for basketball 3-pt); w = radius X, h = full
// diameter along Y. arcRightPath makes a semi-circle pie slice
// opening to +X; arcLeftPath opens to -X.
function arcRightPath(w: number, h: number): string {
  const H2 = h / 2;
  return `M 0 ${-H2} A ${w} ${H2} 0 0 1 0 ${H2} L 0 0 Z`;
}
function arcLeftPath(w: number, h: number): string {
  const H2 = h / 2;
  return `M 0 ${-H2} A ${w} ${H2} 0 0 0 0 ${H2} L 0 0 Z`;
}

function HighlightZoneShape({
  el,
  pxPerFt,
}: {
  el: HighlightZoneElement;
  pxPerFt: number;
}) {
  const w = el.width * pxPerFt;
  const h = el.height * pxPerFt;
  const shape = el.shape ?? "rect";
  if (shape === "arc-right") {
    return <Path data={arcRightPath(w, h)} fill={el.fill} listening={true} />;
  }
  if (shape === "arc-left") {
    return <Path data={arcLeftPath(w, h)} fill={el.fill} listening={true} />;
  }
  if (shape === "ring" && el.holes && el.holes.length > 0) {
    // Rectangle minus EVERY court — one path: the outer rect clockwise, each
    // court counter-clockwise, so the courts are punched out under the default
    // (non-zero) fill rule. Multi-court friendly (each court's run-off shows,
    // the courts stay clear).
    let d = `M ${-w / 2} ${-h / 2} h ${w} v ${h} h ${-w} Z`;
    for (const hole of el.holes) {
      const hw = hole.w * pxPerFt;
      const hh = hole.h * pxPerFt;
      const hx = hole.cx * pxPerFt;
      const hy = hole.cy * pxPerFt;
      d += ` M ${hx - hw / 2} ${hy - hh / 2} v ${hh} h ${hw} v ${-hh} Z`;
    }
    return <Path data={d} fill={el.fill} listening={true} />;
  }
  if (
    shape === "ring" &&
    el.holeW != null &&
    el.holeH != null &&
    el.holeCx != null &&
    el.holeCy != null
  ) {
    // Rectangle minus an inner cutout, drawn as 4 strips (top, bottom,
    // left, right) around the hole. Reliable across renderers vs an
    // even-odd fill. All values in canvas px, origin at zone centre.
    const hw = el.holeW * pxPerFt;
    const hh = el.holeH * pxPerFt;
    const hx = el.holeCx * pxPerFt;
    const hy = el.holeCy * pxPerFt;
    const holeTop = hy - hh / 2;
    const holeBot = hy + hh / 2;
    const holeLeft = hx - hw / 2;
    const holeRight = hx + hw / 2;
    const strips = [
      // Top strip — full width, above the hole.
      { x: -w / 2, y: -h / 2, width: w, height: holeTop - -h / 2 },
      // Bottom strip — full width, below the hole.
      { x: -w / 2, y: holeBot, width: w, height: h / 2 - holeBot },
      // Left strip — between hole top/bottom, left of hole.
      { x: -w / 2, y: holeTop, width: holeLeft - -w / 2, height: hh },
      // Right strip — between hole top/bottom, right of hole.
      { x: holeRight, y: holeTop, width: w / 2 - holeRight, height: hh },
    ];
    return (
      <>
        {strips.map((s, i) =>
          s.width > 0.5 && s.height > 0.5 ? (
            <Rect
              key={i}
              x={s.x}
              y={s.y}
              width={s.width}
              height={s.height}
              fill={el.fill}
              listening={true}
            />
          ) : null,
        )}
      </>
    );
  }
  // No stroke — reads as a tinted zone rather than a boxed rectangle.
  return (
    <Rect
      x={-w / 2}
      y={-h / 2}
      width={w}
      height={h}
      fill={el.fill}
      listening={true}
    />
  );
}

function FenceRectShapeBase({ el, pxPerFt }: { el: FenceRectElement; pxPerFt: number }) {
  const w = el.width * pxPerFt;
  const h = el.height * pxPerFt;
  const color = el.color ?? "#94a3b8";
  // Diagonal cross-hatch to read as chain-link in 2D. Spacing scales with
  // the fence size so the pattern stays legible at any zoom.
  const step = Math.max(6, Math.min(w, h) * 0.04);
  const lines: JSX.Element[] = [];
  for (let i = -h; i < w + h; i += step) {
    lines.push(
      <Line
        key={`a${i}`}
        points={[-w / 2 + i, -h / 2, -w / 2 + i + h, h / 2]}
        stroke={color}
        strokeWidth={1}
        opacity={0.55}
      />
    );
    lines.push(
      <Line
        key={`b${i}`}
        points={[-w / 2 + i, h / 2, -w / 2 + i + h, -h / 2]}
        stroke={color}
        strokeWidth={1}
        opacity={0.55}
      />
    );
  }
  // Mask the cross-hatch to inside the rectangle by drawing a clipped
  // group. Konva's clipFunc gives us a fast rectangular clip.
  const gateGap = Math.min(Math.max(w, h) * 0.12, 30);
  return (
    <>
      <Group
        clipX={-w / 2}
        clipY={-h / 2}
        clipWidth={w}
        clipHeight={h}
      >
        {lines}
      </Group>
      {/* Outer rectangle, with the gate edge broken in the middle to
          suggest an opening. */}
      <FenceOutline
        w={w}
        h={h}
        color={color}
        gateGap={el.hasGate ? gateGap : 0}
        gateEdge={el.gateEdge ?? "south"}
      />
    </>
  );
}

function FenceOutline({
  w,
  h,
  color,
  gateGap,
  gateEdge,
}: {
  w: number;
  h: number;
  color: string;
  gateGap: number;
  gateEdge: "north" | "south" | "east" | "west";
}) {
  // Translate the plot-space gate direction names to canvas edges. The
  // 2D canvas has y growing downward, so "north" on the plot (towards
  // top of canvas) is the TOP edge here, "south" is the BOTTOM edge.
  const e: "top" | "bottom" | "left" | "right" =
    gateEdge === "north" ? "top" :
    gateEdge === "south" ? "bottom" :
    gateEdge === "east" ? "right" :
    "left";
  const half = gateGap / 2;
  const segs: Array<[number, number, number, number]> = [];
  // Build four edges; on the gate edge we leave a centred gap.
  if (e === "top") {
    segs.push([-w / 2, -h / 2, -half, -h / 2]);
    segs.push([half, -h / 2, w / 2, -h / 2]);
  } else {
    segs.push([-w / 2, -h / 2, w / 2, -h / 2]);
  }
  if (e === "bottom") {
    segs.push([-w / 2, h / 2, -half, h / 2]);
    segs.push([half, h / 2, w / 2, h / 2]);
  } else {
    segs.push([-w / 2, h / 2, w / 2, h / 2]);
  }
  if (e === "left") {
    segs.push([-w / 2, -h / 2, -w / 2, -half]);
    segs.push([-w / 2, half, -w / 2, h / 2]);
  } else {
    segs.push([-w / 2, -h / 2, -w / 2, h / 2]);
  }
  if (e === "right") {
    segs.push([w / 2, -h / 2, w / 2, -half]);
    segs.push([w / 2, half, w / 2, h / 2]);
  } else {
    segs.push([w / 2, -h / 2, w / 2, h / 2]);
  }
  return (
    <>
      {segs.map(([x1, y1, x2, y2], i) => (
        <Line
          key={i}
          points={[x1, y1, x2, y2]}
          stroke={color}
          strokeWidth={2.5}
          lineCap="round"
        />
      ))}
    </>
  );
}

function DugoutShape({ el, pxPerFt }: { el: DugoutElement; pxPerFt: number }) {
  const w = el.width * pxPerFt;
  const h = el.height * pxPerFt;
  const roof = el.roofColor ?? "#475569";
  const bench = el.benchColor ?? "#cbd5e1";
  // Open side rendered as a thinner edge so the customer can tell which
  // way the dugout faces.
  const openEdge =
    el.openSide === "north" ? "top" :
    el.openSide === "south" ? "bottom" :
    el.openSide === "east" ? "right" :
    "left";
  const wallThickness = Math.max(2, Math.min(w, h) * 0.08);
  return (
    <>
      {/* Roof + bench fill */}
      <Rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        fill={roof}
        cornerRadius={2}
      />
      {/* Bench seat strip — runs along the closed (back) side */}
      <Rect
        x={
          openEdge === "right"
            ? -w / 2 + wallThickness
            : openEdge === "left"
              ? w / 2 - wallThickness - h * 0.35
              : -w / 2 + w * 0.2
        }
        y={
          openEdge === "bottom"
            ? -h / 2 + wallThickness
            : openEdge === "top"
              ? h / 2 - wallThickness - h * 0.35
              : -h / 2 + wallThickness
        }
        width={
          openEdge === "left" || openEdge === "right" ? h * 0.35 : w * 0.6
        }
        height={
          openEdge === "left" || openEdge === "right" ? h - wallThickness * 2 : h * 0.35
        }
        fill={bench}
        cornerRadius={1}
      />
      {/* Open side marker — a slim line where the opening is, so users
          can spot orientation at a glance. */}
      <Line
        points={
          openEdge === "top"
            ? [-w / 2 + 2, -h / 2, w / 2 - 2, -h / 2]
            : openEdge === "bottom"
              ? [-w / 2 + 2, h / 2, w / 2 - 2, h / 2]
              : openEdge === "left"
                ? [-w / 2, -h / 2 + 2, -w / 2, h / 2 - 2]
                : [w / 2, -h / 2 + 2, w / 2, h / 2 - 2]
        }
        stroke="#ffffff"
        strokeWidth={2.5}
        dash={[4, 3]}
      />
    </>
  );
}

// Bottom-right watermark. Loads the image once and scales it to ~14% of
// the canvas width so it's visible without dominating the design.
function Watermark({
  url,
  opacity,
  canvasWidth,
  canvasHeight,
}: {
  url: string;
  opacity: number;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const i = new window.Image();
    i.crossOrigin = "anonymous";
    i.onload = () => setImg(i);
    i.src = url;
    return () => {
      i.onload = null;
    };
  }, [url]);
  if (!img) return null;
  // Fixed-height logo box (WATERMARK_BOX_H) so the material callout above it
  // can reserve exactly WATERMARK_RESERVE and never overlap. Width follows
  // the aspect ratio, capped so a very wide logo stays inside the corner
  // (capping shortens the height, which only shrinks the reserve — safe).
  let targetH = WATERMARK_BOX_H;
  let targetW = (img.naturalWidth / img.naturalHeight) * targetH;
  const maxW = canvasWidth * 0.26;
  if (targetW > maxW) {
    targetW = maxW;
    targetH = (img.naturalHeight / img.naturalWidth) * targetW;
  }
  const margin = 14;
  return (
    <>
      {/* Subtle white pill behind the logo for legibility on dark grass */}
      <Rect
        x={canvasWidth - targetW - margin * 2}
        y={canvasHeight - targetH - margin * 2}
        width={targetW + margin}
        height={targetH + margin}
        fill="rgba(255,255,255,0.78)"
        cornerRadius={6}
        opacity={opacity}
      />
      <KonvaImage
        image={img}
        x={canvasWidth - targetW - margin * 1.5}
        y={canvasHeight - targetH - margin * 1.5}
        width={targetW}
        height={targetH}
        opacity={opacity}
      />
    </>
  );
}

function BasketballHoopShape({
  el,
  pxPerFt,
}: {
  el: BasketballHoopElement;
  pxPerFt: number;
}) {
  // In top-down 2D, draw the backboard as a short bar with the rim circle
  // peeking out on one side. The pole is a small dot at the back.
  const backboardW = el.backboardWidthFt * pxPerFt;
  const color = el.color ?? "#0f172a";
  const rimColor = el.rimColor ?? "#ef4444";
  const rimR = Math.max(4, backboardW * 0.13);
  return (
    <>
      {/* Backboard */}
      <Rect
        x={-backboardW / 2}
        y={-2}
        width={backboardW}
        height={4}
        fill={color}
      />
      {/* Pole base — behind the backboard */}
      <Circle x={0} y={-6} radius={3} fill={color} />
      {/* Rim — in front of the backboard */}
      <Circle
        x={0}
        y={rimR + 4}
        radius={rimR}
        stroke={rimColor}
        strokeWidth={2}
        fill="rgba(239,68,68,0.15)"
      />
    </>
  );
}

// ── P6 facility elements — top-down 2D icons ─────────────────────────
// Each draws around the element origin (0,0); the parent Group applies the
// plot-space position + rotation. Kept icon-simple so they read at plot scale.

// Floodlight mast — pole dot, head crossbar, and a soft beam cone pointing
// along the mast's local +Y (which the parent rotation aims at the field).
function FloodlightShape({ el, pxPerFt }: { el: FloodlightElement; pxPerFt: number }) {
  const lamp = kelvinTo2DColor(el.colorTempK ?? 5000);
  const reach = Math.max(6, (el.aimReachFt ?? 40) * pxPerFt);
  const spread = reach * 0.45;
  const barW = Math.max(10, (el.heads ?? 4) * 5);
  const headW = barW / Math.max(1, el.heads ?? 4);
  const heads: JSX.Element[] = [];
  for (let i = 0; i < (el.heads ?? 4); i++) {
    heads.push(
      <Rect
        key={i}
        x={-barW / 2 + i * headW + 0.6}
        y={-9}
        width={headW - 1.2}
        height={5}
        fill={lamp}
        cornerRadius={1}
      />,
    );
  }
  return (
    <>
      {/* Beam cone — pale wash toward +Y (canvas up = north at rotation 0). */}
      <Line
        points={[0, -4, -spread, -reach, spread, -reach]}
        closed
        fillLinearGradientStartPoint={{ x: 0, y: -4 }}
        fillLinearGradientEndPoint={{ x: 0, y: -reach }}
        fillLinearGradientColorStops={[0, "rgba(255,244,214,0.5)", 1, "rgba(255,244,214,0)"]}
        listening={false}
      />
      {/* Pole base */}
      <Circle x={0} y={0} radius={4} fill="#334155" />
      {/* Crossbar */}
      <Rect x={-barW / 2} y={-7} width={barW} height={3} fill="#1f2937" cornerRadius={1} />
      {heads}
    </>
  );
}

// Spectator seating — a tiered stand drawn as nested rows getting shorter
// toward the front (local +Y = toward the field).
function SeatingShape({ el, pxPerFt }: { el: SeatingElement; pxPerFt: number }) {
  const w = el.width * pxPerFt;
  const d = el.depth * pxPerFt;
  const rows = Math.max(2, Math.min(8, el.rows ?? 4));
  const rowH = d / rows;
  const base = el.color ?? "#3b82f6";
  const strips: JSX.Element[] = [];
  for (let i = 0; i < rows; i++) {
    // Back rows (top, local -Y) darkest; front rows lighter — reads as tiers.
    strips.push(
      <Rect
        key={i}
        x={-w / 2}
        y={-d / 2 + i * rowH}
        width={w}
        height={rowH - 1}
        fill={shadeHexColor(base, 0.7 + (0.35 * i) / rows)}
        stroke="rgba(15,23,42,0.35)"
        strokeWidth={0.75}
      />,
    );
  }
  return <>{strips}</>;
}

// Scoreboard — dark panel on two posts with a faint "0:0" hint.
function ScoreboardShape({ el, pxPerFt }: { el: ScoreboardElement; pxPerFt: number }) {
  const w = el.widthFt * pxPerFt;
  const h = Math.max(8, w * 0.55);
  const frame = el.color ?? "#0f172a";
  return (
    <>
      <Rect x={-w / 2 - 2} y={-h / 2 - 2} width={w + 4} height={h + 4} fill={frame} cornerRadius={2} />
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill="#111827" cornerRadius={1.5} />
      <Text
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        align="center"
        verticalAlign="middle"
        text="0 : 0"
        fontSize={Math.max(6, h * 0.5)}
        fill="#22d3ee"
        fontStyle="bold"
      />
    </>
  );
}

// Cricket sight-screen — a large pale board (top-down: a thin bright bar).
function SightScreenShape({ el, pxPerFt }: { el: SightScreenElement; pxPerFt: number }) {
  const w = el.widthFt * pxPerFt;
  const depth = Math.max(5, w * 0.14);
  const fill = el.color ?? "#f1f5f9";
  return (
    <Rect
      x={-w / 2}
      y={-depth / 2}
      width={w}
      height={depth}
      fill={fill}
      stroke="rgba(15,23,42,0.45)"
      strokeWidth={1}
      cornerRadius={1}
    />
  );
}

// Corner flag — small post dot + a triangular flag.
function CornerFlagShape({ el, pxPerFt }: { el: CornerFlagElement; pxPerFt: number }) {
  const s = Math.max(6, (el.heightFt ?? 5) * pxPerFt * 0.5);
  const flag = el.color ?? "#ef4444";
  return (
    <>
      <Circle x={0} y={0} radius={2.5} fill="#1f2937" />
      <Line points={[0, 0, s * 0.9, -s * 0.35, 0, -s * 0.7]} closed fill={flag} />
    </>
  );
}

// Gate — two posts with a swing-leaf arc, opening toward local +Y.
function GateShape({ el, pxPerFt }: { el: GateElement; pxPerFt: number }) {
  const w = el.widthFt * pxPerFt;
  const color = el.color ?? "#94a3b8";
  return (
    <>
      <Circle x={-w / 2} y={0} radius={3} fill={color} />
      <Circle x={w / 2} y={0} radius={3} fill={color} />
      {/* Swing leaf from the left post */}
      <Line points={[-w / 2, 0, -w / 2 + w * 0.7, -w * 0.5]} stroke={color} strokeWidth={2.5} lineCap="round" />
      <Arc
        x={-w / 2}
        y={0}
        innerRadius={w * 0.7}
        outerRadius={w * 0.7}
        angle={45}
        rotation={-90}
        stroke={color}
        strokeWidth={1}
        dash={[3, 3]}
      />
    </>
  );
}

// Centre-court logo — a crest disc. Draws the logo image when it loads,
// otherwise a coloured ring with optional initials.
function CenterLogoShape({ el, pxPerFt }: { el: CenterLogoElement; pxPerFt: number }) {
  const r = (el.diameterFt * pxPerFt) / 2;
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!el.imageUrl) {
      setImg(null);
      return;
    }
    const i = new window.Image();
    i.crossOrigin = "anonymous";
    i.onload = () => setImg(i);
    i.src = el.imageUrl;
    return () => {
      i.onload = null;
    };
  }, [el.imageUrl]);
  const ring = el.color ?? "#ffffff";
  return (
    <>
      <Circle x={0} y={0} radius={r} stroke={ring} strokeWidth={Math.max(1.5, r * 0.06)} fill="rgba(255,255,255,0.06)" />
      {img ? (
        <KonvaImage
          image={img}
          x={-r * 0.8}
          y={-r * 0.8}
          width={r * 1.6}
          height={r * 1.6}
        />
      ) : (
        <Text
          x={-r}
          y={-r}
          width={r * 2}
          height={r * 2}
          align="center"
          verticalAlign="middle"
          text={el.text ?? "LOGO"}
          fontSize={Math.max(6, r * 0.4)}
          fill={ring}
          fontStyle="bold"
        />
      )}
    </>
  );
}

// Approximate colour-temperature → hex for the 2D floodlight lamp swatch.
function kelvinTo2DColor(k: number): string {
  if (k <= 3000) return "#ffd1a0";
  if (k <= 4200) return "#ffe6c2";
  if (k <= 5200) return "#fff4d6";
  return "#eef4ff";
}

// P6-02: obstacle marker — a small tree (green canopy + brown trunk dot) or a
// grey pole, drawn at a fixed canvas position (the parent Layer isn't rotated).
function ObstacleMarker({
  x,
  y,
  radiusPx,
  kind,
}: {
  x: number;
  y: number;
  radiusPx: number;
  kind: "tree" | "pole";
}) {
  if (kind === "pole") {
    return (
      <>
        <Circle x={x} y={y} radius={radiusPx * 0.5} fill="#64748b" stroke="#334155" strokeWidth={1.5} />
      </>
    );
  }
  return (
    <>
      <Circle x={x} y={y} radius={radiusPx} fill="rgba(34,120,54,0.55)" stroke="#1f6d33" strokeWidth={1.5} />
      <Circle x={x} y={y} radius={radiusPx * 0.28} fill="#7c4a25" />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Grid + helpers
// ─────────────────────────────────────────────────────────────────────

// Plot dimension labels — drawn just outside the plot footprint so they
// don't compete with court markings but stay inside the PNG export. Top
// edge shows length, left edge shows width. Each label has tick marks at
// the corners + the dimension text. Uses a high-contrast white drop-shadow
// so they read on both grass and earth-coloured backgrounds.
// Compact dimensions readout in the bottom-left corner of every design:
// plot size, court size (the drawn playing surface), and the non-playing area
// (plot − court) — each in feet AND metres. Drawn on the canvas so it also
// appears in the exported PNG the customer receives.
// Width of the right-hand column reserved on the canvas for the dimensions
// card (top) + the material callout (below it).
const RIGHT_COL_W = 230;

// Fixed metrics for the right-column stack. Everything on the right —
// DIMENSIONS card, material/product callout, watermark — is positioned
// relative to the CANVAS (a clean top→bottom stack), never relative to the
// plot. A short plot (e.g. a 105 × 13 ft cricket strip) sits as a thin band
// mid-canvas; the old plot-relative offsets collapsed for such plots and
// made the card, callout and logo overlap. Anchoring to the canvas fixes
// that for every plot shape.
const DIM_TOP = 14; // card's top y (clears the top HTML controls in editor)
const DIM_TITLE_H = 22;
const DIM_ROW_H = 12;
const DIM_PAD = 8;
// Group courts by (rounded) size so the DIMENSIONS card lists each DISTINCT
// court size — a multi-sport plot has different-sized courts; a tiled
// single-sport plot has one size shown as "×N".
function courtSizeGroups(areas: DesignAreas): Array<{
  label: string;
  lengthFt: number;
  widthFt: number;
  count: number;
  areaSqFt: number;
}> {
  const groups: Array<{
    label: string;
    lengthFt: number;
    widthFt: number;
    count: number;
    areaSqFt: number;
  }> = [];
  for (const c of areas.courts) {
    const g = groups.find(
      (x) =>
        x.label === c.label &&
        Math.round(x.lengthFt) === Math.round(c.lengthFt) &&
        Math.round(x.widthFt) === Math.round(c.widthFt),
    );
    if (g) {
      g.count += 1;
      g.areaSqFt += c.areaSqFt;
    } else {
      groups.push({
        label: c.label,
        lengthFt: c.lengthFt,
        widthFt: c.widthFt,
        count: 1,
        areaSqFt: c.areaSqFt,
      });
    }
  }
  return groups;
}
// Number of stacked sections in the DIMENSIONS card: Plot, [one per named
// court], [distance between courts], Non-playing, Total.
function dimSectionCount(areas: DesignAreas): number {
  const gapRow = areas.courtGapFt && areas.courtGapFt > 0 ? 1 : 0;
  return 3 + courtSizeGroups(areas).length + gapRow;
}
// Deterministic card height so the render can place the callout directly
// below it without prop-drilling the panel's internal layout.
function dimPanelHeight(areas: DesignAreas): number {
  return DIM_TITLE_H + DIM_PAD + dimSectionCount(areas) * 3 * DIM_ROW_H + DIM_PAD;
}
// Height the watermark box occupies at the bottom-right (logo 52 + margins).
// The Watermark component renders to a fixed 52 px tall box so this reserve
// is exact and the callout above can be clamped to never touch it.
const WATERMARK_BOX_H = 52;
const WATERMARK_RESERVE = WATERMARK_BOX_H + 36;

// Prominent dimensions card — top-right of every design (baked into the
// exported PNG) so sales + the customer read the sizes at a glance. Each of
// Plot / Playing area / Non-playing shows "L × W ft = A sq.ft" and
// "L × W m = A sq.m".
function DesignInfoPanel({
  areas,
  top,
  canvasWidth,
}: {
  areas: DesignAreas;
  top: number;
  canvasWidth: number;
}) {
  const FT_M = 0.3048;
  const SQFT_SQM = 0.092903;
  const ft = (v: number) => {
    const r = Math.round(v * 10) / 10;
    return Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1);
  };
  const mt = (v: number) => (v * FT_M).toFixed(2);
  const nf = (n: number) => Math.round(n).toLocaleString("en-IN");

  type Sec = { label: string; ftLine: string; mLine: string };
  const secs: Sec[] = [];
  const p = areas.plot;
  secs.push({
    label: "Plot",
    ftLine: `${ft(p.lengthFt)} × ${ft(p.widthFt)} ft = ${nf(p.areaSqFt)} sq.ft`,
    mLine: `${mt(p.lengthFt)} × ${mt(p.widthFt)} m = ${nf(p.areaSqFt * SQFT_SQM)} sq.m`,
  });
  // One section per NAMED court, so a multi-sport plot shows each sport's own
  // playing area (e.g. "Basketball — 92 × 49 ft").
  for (const g of courtSizeGroups(areas)) {
    const n = g.count;
    // Cricket pitch: spell out width + length in both units for clarity.
    if (g.label === "Cricket pitch") {
      secs.push({
        label: "Cricket pitch",
        ftLine: `${Math.round(g.widthFt)} ft width × ${Math.round(g.lengthFt)} ft length`,
        mLine: `${Math.round(g.widthFt * 0.3048)} m width × ${Math.round(g.lengthFt * 0.3048)} m length`,
      });
      continue;
    }
    secs.push({
      label:
        n === 1 ? `${g.label} — playing area` : `${g.label} — playing area (×${n})`,
      ftLine:
        n === 1
          ? `${ft(g.lengthFt)} × ${ft(g.widthFt)} ft = ${nf(g.areaSqFt)} sq.ft`
          : `${n} × ${ft(g.lengthFt)} × ${ft(g.widthFt)} ft = ${nf(g.areaSqFt)} sq.ft`,
      mLine:
        n === 1
          ? `${mt(g.lengthFt)} × ${mt(g.widthFt)} m = ${nf(g.areaSqFt * SQFT_SQM)} sq.m`
          : `${n} × ${mt(g.lengthFt)} × ${mt(g.widthFt)} m = ${nf(g.areaSqFt * SQFT_SQM)} sq.m`,
    });
  }
  // Spacing between tiled courts, when the user set one.
  if (areas.courtGapFt && areas.courtGapFt > 0) {
    secs.push({
      label: "Distance between courts",
      ftLine: `${ft(areas.courtGapFt)} ft`,
      mLine: `${mt(areas.courtGapFt)} m`,
    });
  }
  secs.push({
    label: "Non-playing (run-off)",
    ftLine: `${nf(areas.nonPlayingSqFt)} sq.ft`,
    mLine: `${nf(areas.nonPlayingSqFt * SQFT_SQM)} sq.m`,
  });
  const totalSqFt = areas.courtAreaSqFt + areas.nonPlayingSqFt;
  secs.push({
    label: "Total area (playing + run-off)",
    ftLine: `${nf(totalSqFt)} sq.ft`,
    mLine: `${nf(totalSqFt * SQFT_SQM)} sq.m`,
  });

  const rows: { text: string; kind: "label" | "val" }[] = [];
  for (const s of secs) {
    rows.push({ text: s.label, kind: "label" });
    rows.push({ text: s.ftLine, kind: "val" });
    rows.push({ text: s.mLine, kind: "val" });
  }

  const boxW = RIGHT_COL_W - 14;
  const x = canvasWidth - RIGHT_COL_W + 6;
  // Anchored at the canvas top (fixed), not the plot — so a short cricket
  // strip doesn't push the card down into the callout + logo.
  const y = top;
  const titleH = DIM_TITLE_H;
  const pad = DIM_PAD;
  const rowH = DIM_ROW_H;
  const fontSize = 10.5;
  const boxH = dimPanelHeight(areas);

  return (
    <Group listening={false} name="dim-panel">
      <Rect
        x={x}
        y={y}
        width={boxW}
        height={boxH}
        fill="#ffffff"
        stroke="#0f766e"
        strokeWidth={1.5}
        cornerRadius={7}
        shadowColor="rgba(0,0,0,0.22)"
        shadowBlur={7}
        shadowOffsetY={2}
      />
      <Rect
        x={x}
        y={y}
        width={boxW}
        height={titleH}
        fill="#0f766e"
        cornerRadius={[7, 7, 0, 0]}
      />
      <Text
        text="DIMENSIONS"
        x={x + pad}
        y={y + 6}
        fontSize={11}
        fontStyle="700"
        fill="#ffffff"
        letterSpacing={1}
        fontFamily="system-ui, -apple-system, sans-serif"
      />
      {rows.map((r, i) => (
        <Text
          key={i}
          text={r.text}
          x={x + pad}
          y={y + titleH + pad + i * rowH}
          width={boxW - pad * 2}
          fontSize={r.kind === "label" ? fontSize : fontSize * 0.96}
          fontStyle={r.kind === "label" ? "700" : "400"}
          fill={r.kind === "label" ? "#0f766e" : "#1e293b"}
          fontFamily="system-ui, -apple-system, sans-serif"
          wrap="none"
        />
      ))}
    </Group>
  );
}

function PlotDimensions({
  plotOriginX,
  plotOriginY,
  plotPxWidth,
  plotPxHeight,
  plotLengthFt,
  plotWidthFt,
}: {
  plotOriginX: number;
  plotOriginY: number;
  plotPxWidth: number;
  plotPxHeight: number;
  plotLengthFt: number;
  plotWidthFt: number;
}) {
  const labelFontSize = Math.max(11, Math.min(plotPxWidth, plotPxHeight) * 0.025);
  const tickLen = labelFontSize * 0.7;
  const offset = labelFontSize * 1.6;
  const labelColor = "#0f172a";
  const lineColor = "#0f172a";
  const lineWidth = 1.2;
  // P1-05: proper CAD leaders — witness/extension lines off each plot edge and
  // filled arrowheads on the dimension line (reusing the CustomLineShape
  // triangle pattern) instead of plain end ticks. `snap` keeps the thin strokes
  // on the half-pixel grid so they stay crisp.
  const headLen = Math.max(6, tickLen);
  const headHalf = headLen * 0.42;
  const witnessGap = tickLen * 0.35; // small break between the plot edge + line
  const witnessExt = tickLen * 0.5; // extension a touch past the dimension line
  const snap = (v: number) => Math.round(v) + 0.5;

  // Top: horizontal dimension line above the plot.
  const topY = plotOriginY - offset;
  // Dual-unit dimension labels (Option C — every exported PNG shows both
  // ft + m so customers never have to convert). Uses the international
  // foot: 1 ft = 0.3048 m.
  const lengthLabel = `${plotLengthFt} ft (${(plotLengthFt * 0.3048).toFixed(1)} m)`;
  // Left: vertical dimension line to the left of the plot.
  const leftX = plotOriginX - offset;
  const widthLabel = `${plotWidthFt} ft (${(plotWidthFt * 0.3048).toFixed(1)} m)`;

  const rightX0 = plotOriginX + plotPxWidth;
  const botY0 = plotOriginY + plotPxHeight;
  return (
    <>
      {/* Top dimension — length. Witness lines rise from the plot's top edge
          past the dimension line; the dimension line carries a filled arrowhead
          at each end pointing out to the witness lines. */}
      <Line
        points={[snap(plotOriginX), plotOriginY - witnessGap, snap(plotOriginX), topY - witnessExt]}
        stroke={lineColor}
        strokeWidth={1}
        listening={false}
      />
      <Line
        points={[snap(rightX0), plotOriginY - witnessGap, snap(rightX0), topY - witnessExt]}
        stroke={lineColor}
        strokeWidth={1}
        listening={false}
      />
      <Line
        points={[plotOriginX, snap(topY), rightX0, snap(topY)]}
        stroke={lineColor}
        strokeWidth={lineWidth}
        listening={false}
      />
      {/* Filled arrowheads pointing outward to each witness line */}
      <Line
        points={[plotOriginX, topY, plotOriginX + headLen, topY - headHalf, plotOriginX + headLen, topY + headHalf]}
        closed
        fill={lineColor}
        listening={false}
      />
      <Line
        points={[rightX0, topY, rightX0 - headLen, topY - headHalf, rightX0 - headLen, topY + headHalf]}
        closed
        fill={lineColor}
        listening={false}
      />
      {/* Length text — dual-unit "80 ft (24.4 m)". Pill widened to fit
          both units without truncation. */}
      <Rect
        x={plotOriginX + plotPxWidth / 2 - labelFontSize * 4}
        y={topY - labelFontSize * 0.75}
        width={labelFontSize * 8}
        height={labelFontSize * 1.4}
        fill="rgba(255,255,255,0.92)"
        cornerRadius={labelFontSize * 0.25}
      />
      <Text
        text={lengthLabel}
        fontSize={labelFontSize}
        fontStyle="600"
        fontFamily="system-ui, -apple-system, sans-serif"
        fill={labelColor}
        x={plotOriginX + plotPxWidth / 2 - labelFontSize * 4}
        y={topY - labelFontSize * 0.55}
        width={labelFontSize * 8}
        align="center"
      />

      {/* Left dimension — width. Witness lines run out from the plot's left
          edge; the vertical dimension line has arrowheads pointing up/down. */}
      <Line
        points={[plotOriginX - witnessGap, snap(plotOriginY), leftX - witnessExt, snap(plotOriginY)]}
        stroke={lineColor}
        strokeWidth={1}
        listening={false}
      />
      <Line
        points={[plotOriginX - witnessGap, snap(botY0), leftX - witnessExt, snap(botY0)]}
        stroke={lineColor}
        strokeWidth={1}
        listening={false}
      />
      <Line
        points={[snap(leftX), plotOriginY, snap(leftX), botY0]}
        stroke={lineColor}
        strokeWidth={lineWidth}
        listening={false}
      />
      <Line
        points={[leftX, plotOriginY, leftX - headHalf, plotOriginY + headLen, leftX + headHalf, plotOriginY + headLen]}
        closed
        fill={lineColor}
        listening={false}
      />
      <Line
        points={[leftX, botY0, leftX - headHalf, botY0 - headLen, leftX + headHalf, botY0 - headLen]}
        closed
        fill={lineColor}
        listening={false}
      />
      {/* Width text — rotated 90° so it reads along the vertical line.
          Pill widened for dual-unit "60 ft (18.3 m)". */}
      <Rect
        x={leftX - labelFontSize * 0.7}
        y={plotOriginY + plotPxHeight / 2 - labelFontSize * 4}
        width={labelFontSize * 1.4}
        height={labelFontSize * 8}
        fill="rgba(255,255,255,0.92)"
        cornerRadius={labelFontSize * 0.25}
      />
      <Text
        text={widthLabel}
        fontSize={labelFontSize}
        fontStyle="600"
        fontFamily="system-ui, -apple-system, sans-serif"
        fill={labelColor}
        x={leftX}
        y={plotOriginY + plotPxHeight / 2}
        // Rotate text 90° counter-clockwise. With offset at (0,0) and
        // rotation -90, the text starts at the anchor and grows upward.
        rotation={-90}
        offsetX={labelFontSize * 4}
        offsetY={labelFontSize * 0.55}
        width={labelFontSize * 8}
        align="center"
      />
    </>
  );
}

function GridLines({
  pxPerFt,
  plotOriginX,
  plotOriginY,
  plotPxWidth,
  plotPxHeight,
  plotLengthFt,
  plotWidthFt,
}: {
  pxPerFt: number;
  plotOriginX: number;
  plotOriginY: number;
  plotPxWidth: number;
  plotPxHeight: number;
  plotLengthFt: number;
  plotWidthFt: number;
}) {
  // Auto-pick grid spacing so we never draw more than ~25 gridlines per axis.
  const targetLines = 12;
  const rawStep = Math.max(plotLengthFt, plotWidthFt) / targetLines;
  const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100];
  const step = niceSteps.find((s) => s >= rawStep) ?? Math.ceil(rawStep / 10) * 10;
  const lines: JSX.Element[] = [];
  for (let ft = 0; ft <= plotLengthFt; ft += step) {
    // P1-05: snap 1px strokes to the half-pixel grid so hairlines render crisp
    // (1px wide) instead of blurred across two device pixels.
    const x = Math.round(plotOriginX + ft * pxPerFt) + 0.5;
    lines.push(
      <Line
        key={`v${ft}`}
        points={[x, plotOriginY, x, plotOriginY + plotPxHeight]}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={1}
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  }
  for (let ft = 0; ft <= plotWidthFt; ft += step) {
    const y = Math.round(plotOriginY + ft * pxPerFt) + 0.5;
    lines.push(
      <Line
        key={`h${ft}`}
        points={[plotOriginX, y, plotOriginX + plotPxWidth, y]}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={1}
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  }
  return <>{lines}</>;
}

// Quick HSL darken for stripe alternation — no chroma swing, just slightly
// less luminance so the second stripe reads as a mowed band.
function darken(hexOrRgb: string, amount: number): string {
  // Support #rrggbb and rgb()/rgba() inputs.
  let r = 0,
    g = 0,
    b = 0,
    a = 1;
  if (hexOrRgb.startsWith("#")) {
    const v = hexOrRgb.slice(1);
    r = parseInt(v.slice(0, 2), 16);
    g = parseInt(v.slice(2, 4), 16);
    b = parseInt(v.slice(4, 6), 16);
  } else {
    const m = hexOrRgb.match(/rgba?\(([^)]+)\)/);
    if (!m) return hexOrRgb;
    const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
    [r, g, b] = parts as [number, number, number];
    if (parts.length === 4) a = parts[3];
  }
  const f = 1 - amount;
  r = Math.max(0, Math.round(r * f));
  g = Math.max(0, Math.round(g * f));
  b = Math.max(0, Math.round(b * f));
  return `rgba(${r},${g},${b},${a})`;
}

// Mirror of `darken` in the other direction — brightens each channel by the
// given fraction (0.08 = 8% lighter). Used so mow stripes alternate ABOVE and
// BELOW the base green instead of the old one-sided darken, for a stronger
// mowed-band read. Handles #rrggbb and rgb()/rgba() inputs like `darken`.
function lighten(hexOrRgb: string, amount: number): string {
  let r = 0,
    g = 0,
    b = 0,
    a = 1;
  if (hexOrRgb.startsWith("#")) {
    const v = hexOrRgb.slice(1);
    r = parseInt(v.slice(0, 2), 16);
    g = parseInt(v.slice(2, 4), 16);
    b = parseInt(v.slice(4, 6), 16);
  } else {
    const m = hexOrRgb.match(/rgba?\(([^)]+)\)/);
    if (!m) return hexOrRgb;
    const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
    [r, g, b] = parts as [number, number, number];
    if (parts.length === 4) a = parts[3];
  }
  const f = 1 + amount;
  r = Math.min(255, Math.round(r * f));
  g = Math.min(255, Math.round(g * f));
  b = Math.min(255, Math.round(b * f));
  return `rgba(${r},${g},${b},${a})`;
}

// Konva fill props for a subtle top→bottom surface gradient (P1-03). Gives
// flat acrylic / tile / plain courts a hint of depth instead of one solid
// block. When the base isn't a #rrggbb hex, shadeHexColor returns it unchanged
// so the gradient collapses to a flat fill of `base` (safe no-op). NOTE: we
// deliberately omit `fill` — Konva's fillPriority defaults to "color", so a
// present `fill` would override the gradient.
function surfaceGradientProps(base: string, heightPx: number) {
  return {
    fillLinearGradientStartPoint: { x: 0, y: 0 },
    fillLinearGradientEndPoint: { x: 0, y: heightPx },
    fillLinearGradientColorStops: [0, base, 1, shadeHexColor(base, 0.92)] as (
      | number
      | string
    )[],
  };
}

// Plot footprint renderer. Behaviour by surface:
//   plain          → tan earth-colour rect, brown border
//   ppe_tile_*     → solid tile-colour base + a single highlighted
//                    sample tile photograph so the customer sees the
//                    real material. Tile count pill in the wizard
//                    handles the material-quantity part.
//   acrylic_*      → uniform solid colour matching the coating shade.
//                    No sample tile (acrylic is a coating, not a tile).
const TILE_SOLID_COLORS: Partial<Record<SurfaceFinish, string>> = {
  ppe_tile_red: "#b93430",
};
// Visual size of the highlighted sample tile in plot feet. Real tiles
// are 30 cm (~1 ft); the sample is enlarged so its texture is legible
// on a 100-ft-wide court.
const SAMPLE_TILE_FT = 6;

function PlotSurface({
  plotOriginX,
  plotOriginY,
  plotPxWidth,
  plotPxHeight,
  pxPerFt,
  surface,
  plotLengthFt,
  plotWidthFt,
  polygon,
  runOffTone,
  runOffColorOverride,
  surfaceColorOverride,
  baseWork,
  productName,
  productImageUrl,
  calloutTopY,
  canvasHeight,
  canvasWidth,
  borderColor,
  primarySport,
}: {
  plotOriginX: number;
  plotOriginY: number;
  plotPxWidth: number;
  plotPxHeight: number;
  pxPerFt: number;
  surface: SurfaceFinish;
  plotLengthFt: number;
  plotWidthFt: number;
  // Optional polygon vertices in PLOT feet (origin bottom-left). When
  // provided, the plot boundary renders as this closed polygon instead
  // of a rectangle. Set from non-standard mode's shape picker.
  polygon?: Array<{ x: number; y: number }>;
  // Run-off zone tone from style. When set, the plot fill is darkened
  // by the corresponding factor so the sport court's rectangle (which
  // draws on top with the FULL surface colour via BasketballCourtShape
  // etc.) reads as a distinct playing area. undefined/"off" preserves
  // legacy single-shade rendering.
  runOffTone?: "off" | "subtle" | "distinct";
  // Explicit run-off colour override — takes precedence over the
  // auto-derived shade. Set from the wizard's colour picker so sales /
  // admin can match a real construction photo or brand palette.
  runOffColorOverride?: string;
  // Explicit surface colour override (any hex). Replaces the
  // built-in SURFACE_SOLID_COLOR / TILE_SOLID_COLORS lookup so sales
  // can dial in a specific brand colour that isn't in the presets.
  surfaceColorOverride?: string;
  // Base work (concrete / asphalt sub-base). On a plain surface the plot
  // fill takes the base colour so the run-off around the court reads as
  // the foundation — matching the 3D pad — instead of bare sand.
  baseWork?: "" | "concrete" | "asphalt" | null;
  // Linked flooring product — when set, the right-side callout shows
  // the actual product photo + name so the customer sees exactly what
  // they're getting instead of only the generic material sample.
  productName?: string;
  productImageUrl?: string;
  // Absolute canvas-y where the material/product callout starts (directly
  // below the DIMENSIONS card). Plus the canvas size so the callout can be
  // aligned to the right-hand column and clamped above the bottom watermark.
  calloutTopY: number;
  canvasHeight: number;
  canvasWidth: number;
  // Optional plot-boundary colour override (style.borderColor).
  borderColor?: string;
  // Primary sport — drives the per-sport run-off (non-playing) default colour.
  primarySport?: Sport;
}) {
  // Plot-frame stroke — hardcoded black (V1: border colour is no longer a
  // user-editable control; the borderColor prop is retained for back-compat).
  const borderStroke = "#111827";
  // P1-03: soft drop shadow so the whole plot reads as lifted off the canvas
  // (depth), scaled to the zoom so it stays subtle at any plot size. Applied
  // only to the outermost plot-base shape — never the stripe/overlay rects —
  // and never to the stroke (shadowForStrokeEnabled=false).
  const plotShadow = {
    shadowColor: "rgba(0,0,0,0.28)",
    shadowBlur: Math.max(4, pxPerFt * 0.5),
    shadowOffsetX: 0,
    shadowOffsetY: Math.max(2, pxPerFt * 0.25),
    shadowForStrokeEnabled: false,
    perfectDrawEnabled: false,
  };
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [productImg, setProductImg] = useState<HTMLImageElement | null>(null);
  const [turfLightImg, setTurfLightImg] = useState<HTMLImageElement | null>(null);
  const [turfDarkImg, setTurfDarkImg] = useState<HTMLImageElement | null>(null);
  const imageUrl = SURFACE_IMAGE_URL[surface];
  const turfUrls = TURF_IMAGE_URLS[surface];

  // P2-02: Konva fillPattern props that tile a material photo across the plot
  // at TRUE scale — one image spans SURFACE_TILE_METERS[surface] metres (a PPE
  // tile is 30 cm, a turf/PVC texture ~1 m). Returns null (→ solid-fill
  // fallback) until the photo has loaded, so the plot never renders blank.
  function tilePatternProps(image: HTMLImageElement | null) {
    const tileM = SURFACE_TILE_METERS[surface];
    if (!image || !image.naturalWidth || !tileM) return null;
    const scale = (tileM * 3.281 * pxPerFt) / image.naturalWidth;
    return {
      fillPatternImage: image,
      fillPatternRepeat: "repeat" as const,
      fillPatternScale: { x: scale, y: scale },
      fillPatternX: 0,
      fillPatternY: 0,
    };
  }

  useEffect(() => {
    if (!imageUrl) {
      setImg(null);
      return;
    }
    const el = new window.Image();
    el.crossOrigin = "anonymous";
    el.src = imageUrl;
    el.onload = () => setImg(el);
    return () => {
      el.onload = null;
    };
  }, [imageUrl]);

  // Load the linked flooring product photo for the callout.
  useEffect(() => {
    if (!productImageUrl) {
      setProductImg(null);
      return;
    }
    const el = new window.Image();
    el.crossOrigin = "anonymous";
    el.src = productImageUrl;
    el.onload = () => setProductImg(el);
    return () => {
      el.onload = null;
    };
  }, [productImageUrl]);

  useEffect(() => {
    if (!turfUrls) {
      setTurfLightImg(null);
      setTurfDarkImg(null);
      return;
    }
    const l = new window.Image();
    l.crossOrigin = "anonymous";
    l.src = turfUrls.light;
    l.onload = () => setTurfLightImg(l);
    const d = new window.Image();
    d.crossOrigin = "anonymous";
    d.src = turfUrls.dark;
    d.onload = () => setTurfDarkImg(d);
    return () => {
      l.onload = null;
      d.onload = null;
    };
  }, [turfUrls]);

  // Convert polygon (plot feet, origin bottom-left, +y up) to canvas
  // pixels (origin top-left, +y down). Return null if no polygon set —
  // caller falls back to a rectangle.
  const polygonFlat = useMemo<number[] | null>(() => {
    if (!polygon || polygon.length < 3) return null;
    const out: number[] = [];
    for (const p of polygon) {
      out.push(plotOriginX + p.x * pxPerFt);
      // Flip Y so plot-space bottom-left becomes canvas bottom-left.
      out.push(plotOriginY + (plotWidthFt - p.y) * pxPerFt);
    }
    return out;
  }, [polygon, plotOriginX, plotOriginY, pxPerFt, plotWidthFt]);

  if (surface === "plain") {
    if (polygonFlat) {
      return (
        <Line
          points={polygonFlat}
          closed
          fill="#caa477"
          stroke={borderStroke}
          strokeWidth={1.5}
          {...plotShadow}
        />
      );
    }
    return (
      <Rect
        x={plotOriginX}
        y={plotOriginY}
        width={plotPxWidth}
        height={plotPxHeight}
        {...surfaceGradientProps("#caa477", plotPxHeight)}
        stroke={borderStroke}
        strokeWidth={1.5}
        {...plotShadow}
      />
    );
  }

  // Explicit hex override wins over the preset lookup. Lets sales
  // paint the plot any colour without needing us to add a new surface
  // preset for every brand tone.
  // On a plain surface (no flooring product tiling the plot), a chosen
  // base work paints the plot fill so the area around the court reads as
  // the concrete/asphalt foundation (mirrors the 3D pad colours).
  const baseWorkColor =
    baseWork === "asphalt"
      ? "#35383d"
      : baseWork === "concrete"
        ? "#c2c8ce"
        : null;
  const solidFillBase =
    surfaceColorOverride ??
    TILE_SOLID_COLORS[surface] ??
    SURFACE_SOLID_COLOR[surface] ??
    baseWorkColor ??
    "#caa477";
  // Run-off (non-playing) area fill. Precedence:
  //   explicit hex  → paint the run-off that colour (court repaints its
  //                   playing area on top for non-tiled surfaces → two-tone)
  //   runOffTone on → derived darker shade of the surface
  //   default/none  → the REAL surface colour, NO tint
  //
  // The per-sport RUNOFF_DEFAULT_COLOR preset is deliberately NOT auto-applied
  // to the plot base. The court only repaints its playing area for non-tiled
  // surfaces, and never in the default runOffTone='off' state — so auto-tinting
  // the base used to FLOOD the entire plot (playing area included) and hide the
  // actual flooring on every default/tiled design. The preset is still one
  // click away via the run-off colour picker's "Default preset" button (which
  // sets runOffColorOverride); proper per-sport ring rendering that leaves the
  // flooring untouched is the Phase-4 rework.
  const solidFill =
    runOffColorOverride && runOffColorOverride !== "none"
      ? runOffColorOverride
      : runOffTone !== "off"
        ? shadeHexColor(solidFillBase, runOffFactor(runOffTone))
        : solidFillBase;
  // A real run-off COLOUR (not the auto shade, not "none") paints the plot
  // fill that solid colour. ONLY for football does the plot go solid — the
  // football pitch redraws its own grass on top, so just the run-off ring
  // takes the colour. Cricket (and any turf without a covering pitch element)
  // keeps its turf so the colour never wipes the whole flooring.
  const runOffColored =
    !!runOffColorOverride && runOffColorOverride !== "none";
  const footballRunOff = runOffColored && primarySport === "football";
  const tiled = isTiledSurface(surface);
  const acrylic = isAcrylicSurface(surface);
  const turf = isTurfSurface(surface);
  const pvc = isPvcSurface(surface);
  // Photo-callout family: any surface that has a sample photograph
  // shown to the customer. PPE tile ships a photo; PVC will pick one up
  // as soon as the image lands at /images/tiles/pvc-sports.jpg.
  const hasSamplePhoto = tiled || pvc;
  const labelFontSize = Math.max(11, Math.min(plotPxWidth, plotPxHeight) * 0.03);
  // Callout sits OUTSIDE the plot in the reserved right-side area, directly
  // below the DIMENSIONS card. The sample photo is square; the info box
  // under it is a bit wider (infoW) so multi-word material lines don't wrap.
  // Max sample-photo size; shrunk below this when the right column is short
  // (wide plots) so the callout always fits above the watermark.
  const calloutMax = 132;
  // The callout shares the DIMENSIONS card's column (flush-right), so the
  // card + photo + info read as one aligned right-hand stack no matter where
  // the plot's right edge falls. (Anchoring to the plot edge left the callout
  // floating mid-canvas for plots narrower than the canvas, e.g. a football
  // field that's height-constrained.)
  const colX = canvasWidth - RIGHT_COL_W + 6;
  const colW = RIGHT_COL_W - 14;
  // Callout starts directly below the DIMENSIONS card (absolute canvas y).
  const sampleY = calloutTopY;
  const infoW = colW;
  const infoX = colX;
  const materialLines = tiled
    ? (() => {
        const c = ppeTileCount(plotLengthFt, plotWidthFt);
        return [
          `${c.total.toLocaleString("en-IN")} PPE tiles`,
          `${c.perLength} × ${c.perWidth} · 30 cm each`,
        ];
      })()
    : acrylic
      ? (() => {
          const a = acrylicLitres(plotLengthFt * plotWidthFt);
          return [
            `${a.total.toLocaleString("en-IN")} L acrylic`,
            `P ${a.primer} · R ${a.resurfacer} · C ${a.color}`,
          ];
        })()
      : turf
        ? (() => {
            const r = turfRollMeters(plotLengthFt, plotWidthFt);
            return [
              `Light ${r.lightMeters.toLocaleString("en-IN")} m`,
              `Dark  ${r.darkMeters.toLocaleString("en-IN")} m`,
              `${r.stripes} stripes · 2 m rolls`,
            ];
          })()
        : pvc
          ? (() => {
              const p = pvcRollCount(plotLengthFt, plotWidthFt);
              return [
                `${p.totalSqM.toLocaleString("en-IN")} m² PVC`,
                `${p.rolls} rolls · 1.8 × 20 m`,
              ];
            })()
          : [];
  // When a real product is linked, lead the callout with its NAME so
  // the customer sees exactly what they're getting (not just "turf").
  const nameLine = productName ? [productName] : [];
  const infoLines =
    materialLines.length > 0 || nameLine.length > 0
      ? [...nameLine, ...materialLines]
      : [];
  const infoH = labelFontSize * (infoLines.length * 1.6 + 0.8);
  // Clamp the sample photo so the whole callout (photo + info box) stays
  // above the bottom-right watermark. As big as calloutMax when there's
  // room; shrinks when the right column is short (wide plots like a cricket
  // strip) down to a 48 px legibility floor. Fit wins over the floor so the
  // logo is never overlapped except on an extremely short canvas.
  const calloutRoom = canvasHeight - sampleY - infoH - 8 - WATERMARK_RESERVE;
  const samplePx = Math.min(calloutMax, Math.max(48, calloutRoom));
  // Centre the (variable-size) photo within the column so it sits above the
  // full-width info box.
  const sampleX = colX + (colW - samplePx) / 2;

  // Turf stripe geometry — VERTICAL mowed bands running along the
  // pitch length (top-to-bottom), alternating light + dark across the
  // width. This matches how football / cricket pitches are actually
  // mowed (stripes down the length), which is what sales asked for.
  // Each stripe is one roll-width (2 m) wide, full plot height tall.
  const stripes = turf
    ? (() => {
        const FT_PER_M = 3.281;
        const stripeFt = TURF_ROLL_WIDTH_M * FT_PER_M;
        const stripePx = stripeFt * pxPerFt;
        const count = Math.ceil(plotPxWidth / stripePx);
        // P1-04: use the (strengthened) preset pair for the default turf so the
        // approved look is preserved, but when a hex surface-colour override is
        // set, derive the mow bands FROM that colour (previously the override
        // was ignored and stripes stayed green) with a wide light/dark spread.
        const hexOverride =
          surfaceColorOverride && /^#?[0-9a-f]{6}$/i.test(surfaceColorOverride)
            ? surfaceColorOverride
            : null;
        const cols = hexOverride
          ? {
              light: shadeHexColor(hexOverride, 1.14),
              dark: shadeHexColor(hexOverride, 0.82),
            }
          : TURF_STRIPE_COLORS[surface] ?? { light: "#3fa050", dark: "#256c30" };
        return Array.from({ length: count }, (_, i) => ({
          x: plotOriginX + i * stripePx,
          width: Math.min(stripePx, plotOriginX + plotPxWidth - (plotOriginX + i * stripePx)),
          isLight: i % 2 === 0,
          fill: i % 2 === 0 ? cols.light : cols.dark,
        }));
      })()
    : null;

  // P2-02: real material-photo fills. The tiled/PVC plot base repeats its
  // sample photo at true tile scale (solid colour is the load-fallback); turf
  // stripes use the light photo on even bands and the dark photo on odd bands,
  // giving a real mowed-grass look while preserving the light/dark mow
  // direction. `null` → the caller keeps its solid fill.
  const basePattern = tiled || pvc ? tilePatternProps(img) : null;
  const stripeFill = (isLight: boolean, fallback: string) =>
    tilePatternProps(isLight ? turfLightImg : turfDarkImg) ?? { fill: fallback };

  return (
    <>
      {/* Solid surface base — clean uniform playing area for PPE tile
          and acrylic. For turf we draw alternating light + dark
          stripes across the plot, matching a real mowed pattern. When
          a polygon boundary is set (non-standard mode), the base is a
          closed Line instead of Rect and the stripe overlay is
          skipped (a polygon-clipped stripe is a later phase). */}
      {polygonFlat ? (
        <Line
          points={polygonFlat}
          closed
          fill={solidFill}
          stroke={borderStroke}
          strokeWidth={1.5}
          {...plotShadow}
        />
      ) : turf && stripes && polygonFlat ? (
        // Turf on a polygon plot — draw the polygon fill first, then
        // the stripe rects on top. Konva's Line closed=true masks the
        // stripes because the polygon fill is drawn AFTER stripes when
        // wrapped in a Group with clipFunc. Simpler here: fill polygon,
        // then overlay stripes that get clipped by an SVG-style path.
        <>
          <Line
            points={polygonFlat}
            closed
            fill={solidFill}
            stroke={borderStroke}
            strokeWidth={1.5}
            {...plotShadow}
          />
          {stripes.map((s, i) => (
            <Rect
              key={i}
              x={s.x}
              y={plotOriginY}
              width={s.width}
              height={plotPxHeight}
              fill={s.fill}
              listening={false}
              globalCompositeOperation="source-atop"
            />
          ))}
          <Line
            points={polygonFlat}
            closed
            stroke={borderStroke}
            strokeWidth={1.5}
            listening={false}
          />
        </>
      ) : turf && stripes ? (
        // Turf: mowed light/dark stripes across the WHOLE plot (playing area +
        // run-off) — for football/cricket the run-off IS turf (the court design
        // itself), never a separate colour. The pitch/markings draw on top.
        <>
          <Rect
            x={plotOriginX}
            y={plotOriginY}
            width={plotPxWidth}
            height={plotPxHeight}
            fill={solidFill}
            stroke={borderStroke}
            strokeWidth={1.5}
            {...plotShadow}
          />
          {stripes.map((s, i) => (
            <Rect
              key={i}
              x={s.x}
              y={plotOriginY}
              width={s.width}
              height={plotPxHeight}
              {...stripeFill(s.isLight, s.fill)}
              listening={false}
            />
          ))}
          <Rect
            x={plotOriginX}
            y={plotOriginY}
            width={plotPxWidth}
            height={plotPxHeight}
            stroke={borderStroke}
            strokeWidth={1.5}
            listening={false}
          />
        </>
      ) : (
        <Rect
          x={plotOriginX}
          y={plotOriginY}
          width={plotPxWidth}
          height={plotPxHeight}
          {...(basePattern ?? surfaceGradientProps(solidFill, plotPxHeight))}
          stroke={borderStroke}
          strokeWidth={1.5}
          {...plotShadow}
        />
      )}

      {/* Product callout on the RIGHT side of the plot — shown ONLY when a
          flooring product is actually linked. With no product selected we
          render nothing here (no generic material sample) per sales' ask:
          no product selected means no product listed on the canvas. */}
      {productName && (
        <>
      {productImg ? (
        <KonvaImage
          image={productImg}
          x={sampleX}
          y={sampleY}
          width={samplePx}
          height={samplePx}
        />
      ) : (
        <>
          {hasSamplePhoto && img && (
            <KonvaImage
              image={img}
              x={sampleX}
              y={sampleY}
              width={samplePx}
              height={samplePx}
            />
          )}
          {(acrylic || (pvc && !img)) && (
            <Rect
              x={sampleX}
              y={sampleY}
              width={samplePx}
              height={samplePx}
              fill={solidFill}
            />
          )}
          {/* Turf callout — TWO photos stacked (light + dark). */}
          {turf && turfLightImg && (
            <KonvaImage
              image={turfLightImg}
              x={sampleX}
              y={sampleY}
              width={samplePx}
              height={samplePx / 2 - 2}
            />
          )}
          {turf && turfDarkImg && (
            <KonvaImage
              image={turfDarkImg}
              x={sampleX}
              y={sampleY + samplePx / 2 + 2}
              width={samplePx}
              height={samplePx / 2 - 2}
            />
          )}
        </>
      )}
      {(tiled || acrylic || turf || pvc) && (
        <Rect
          x={sampleX}
          y={sampleY}
          width={samplePx}
          height={samplePx}
          stroke="#fbbf24"
          strokeWidth={Math.max(1.5, samplePx * 0.02)}
        />
      )}
      {(tiled || acrylic || turf || pvc) && infoLines.length > 0 && (
        <>
          <Rect
            x={infoX}
            y={sampleY + samplePx + 4}
            width={infoW}
            height={infoH}
            fill="rgba(255,255,255,0.94)"
            cornerRadius={4}
          />
          {infoLines.map((text, i) => (
            <Text
              key={i}
              text={text}
              x={infoX}
              y={sampleY + samplePx + 4 + labelFontSize * (0.3 + i * 1.5)}
              width={infoW}
              fontSize={labelFontSize * (i === 0 ? 1.05 : 0.85)}
              fontStyle={i === 0 ? "700" : "500"}
              fill={i === 0 ? "#0f172a" : "#475569"}
              align="center"
            />
          ))}
        </>
      )}
        </>
      )}
    </>
  );
}

