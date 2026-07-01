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

import { useEffect, useMemo, useRef, useState } from "react";
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
} from "@/lib/court-image/schema";
import { aSideProps } from "@/lib/court-image/schema";

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
  showGrid = true,
  readOnly = false,
  handleRef,
}: Props) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Record<string, Konva.Group>>({});

  // Plot-to-canvas conversion. We compute a single scale so the plot fills
  // as much of the canvas as possible while preserving aspect ratio.
  const { pxPerFt, plotOriginX, plotOriginY, plotPxWidth, plotPxHeight } = useMemo(() => {
    const margin = 28; // leave room for the ground border + dimension labels
    const availW = canvasWidth - margin * 2;
    const availH = canvasHeight - margin * 2;
    const scale = Math.min(availW / layout.plot.lengthFt, availH / layout.plot.widthFt);
    const w = layout.plot.lengthFt * scale;
    const h = layout.plot.widthFt * scale;
    return {
      pxPerFt: scale,
      plotOriginX: (canvasWidth - w) / 2,
      plotOriginY: (canvasHeight - h) / 2,
      plotPxWidth: w,
      plotPxHeight: h,
    };
  }, [canvasWidth, canvasHeight, layout.plot.lengthFt, layout.plot.widthFt]);

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
        const url = stage.toDataURL({ pixelRatio, mimeType: "image/png" });
        const sel = selectedIdRef.current;
        if (sel && shapeRefs.current[sel]) {
          transformerRef.current?.nodes([shapeRefs.current[sel]]);
          transformerRef.current?.getLayer()?.batchDraw();
        }
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
          fill={layout.style.groundColor}
        />
        {/* Plot footprint (the actual customer land) — drawn with a faint
            border so even a blank plot is visible against the ground. */}
        <Rect
          x={plotOriginX}
          y={plotOriginY}
          width={plotPxWidth}
          height={plotPxHeight}
          fill="#caa477"
          stroke="#7a5b32"
          strokeWidth={1.5}
        />
        {showGrid && (
          <GridLines
            pxPerFt={pxPerFt}
            plotOriginX={plotOriginX}
            plotOriginY={plotOriginY}
            plotPxWidth={plotPxWidth}
            plotPxHeight={plotPxHeight}
            plotLengthFt={layout.plot.lengthFt}
            plotWidthFt={layout.plot.widthFt}
          />
        )}
        {layout.style.showDimensions !== false && (
          <PlotDimensions
            plotOriginX={plotOriginX}
            plotOriginY={plotOriginY}
            plotPxWidth={plotPxWidth}
            plotPxHeight={plotPxHeight}
            plotLengthFt={layout.plot.lengthFt}
            plotWidthFt={layout.plot.widthFt}
          />
        )}
      </Layer>

      {/* Element layer — sorted by z so cricket pitch sits above football */}
      <Layer>
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
            onSelect={() => onSelect(el.id)}
            onUpdate={(patch) => onUpdate(el.id, patch)}
            registerRef={(node) => {
              if (node) shapeRefs.current[el.id] = node;
              else delete shapeRefs.current[el.id];
            }}
          />
        ))}
      </Layer>

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
            keepRatio={false}
            boundBoxFunc={(_oldBox, newBox) => {
              // Prevent collapsing an element to nothing.
              if (Math.abs(newBox.width) < 12 || Math.abs(newBox.height) < 12) {
                return _oldBox;
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
  onSelect: () => void;
  onUpdate: (patch: Partial<Element>) => void;
  registerRef: (node: Konva.Group | null) => void;
};

function ElementShape({
  element,
  pxPerFt,
  toCanvasX,
  toCanvasY,
  fromCanvasX,
  fromCanvasY,
  style,
  isSelected,
  readOnly,
  onSelect,
  onUpdate,
  registerRef,
}: ElementShapeProps) {
  const groupRef = useRef<Konva.Group>(null);

  useEffect(() => {
    registerRef(groupRef.current);
    return () => registerRef(null);
  }, [registerRef]);

  function handleDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    const plotX = fromCanvasX(node.x());
    const plotY = fromCanvasY(node.y());
    onUpdate({ x: plotX, y: plotY });
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
    onDragEnd: handleDragEnd,
    onTransformEnd: handleTransformEnd,
    ref: groupRef,
    visible: element.visible !== false,
  };

  switch (element.type) {
    case "football-field":
      return (
        <Group {...commonGroupProps}>
          <FootballFieldShape el={element} pxPerFt={pxPerFt} style={style} />
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
          <BasketballCourtShape el={element} pxPerFt={pxPerFt} style={style} />
        </Group>
      );
    case "pickleball-court":
      return (
        <Group {...commonGroupProps}>
          <PickleballCourtShape el={element} pxPerFt={pxPerFt} style={style} />
        </Group>
      );
    case "generic-court":
      return (
        <Group {...commonGroupProps}>
          <GenericCourtShape el={element} pxPerFt={pxPerFt} style={style} />
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
      (patch as Partial<typeof element>).width = element.width * scaleX;
      (patch as Partial<typeof element>).height = element.height * scaleY;
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

function FootballFieldShape({
  el,
  pxPerFt,
  style,
}: {
  el: FootballFieldElement;
  pxPerFt: number;
  style: CourtLayout["style"];
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

  return (
    <>
      {/* Grass */}
      {style.grassStripes ? (
        Array.from({ length: stripeCount }).map((_, i) => (
          <Rect
            key={i}
            x={-w / 2 + i * stripeW}
            y={-h / 2}
            width={stripeW}
            height={h}
            fill={i % 2 ? grassColor : darken(grassColor, 0.08)}
          />
        ))
      ) : (
        <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill={grassColor} />
      )}

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
    </>
  );
}

function CricketPitchShape({
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
    </>
  );
}

function BasketballCourtShape({
  el,
  pxPerFt,
  style,
}: {
  el: BasketballCourtElement;
  pxPerFt: number;
  style: CourtLayout["style"];
}) {
  const w = el.width * pxPerFt;
  const h = el.height * pxPerFt;
  const fill = el.surfaceColor ?? style.basketballSurfaceColor;
  const line = el.lineColor ?? "#fff5e6";
  const lineWidth = Math.max(1, Math.min(w, h) * 0.005);
  const keyW = w * 0.18;
  const keyH = h * 0.32;
  const ftR = Math.min(w, h) * 0.07;
  const threeR = Math.min(w, h) * 0.34;
  return (
    <>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill={fill} />
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} stroke={line} strokeWidth={lineWidth} />
      {!el.halfCourt && (
        <Line points={[0, -h / 2, 0, h / 2]} stroke={line} strokeWidth={lineWidth} />
      )}
      {!el.halfCourt && (
        <Circle x={0} y={0} radius={Math.min(w, h) * 0.07} stroke={line} strokeWidth={lineWidth} />
      )}

      {/* Two ends — key + free throw circle + 3 point arc */}
      {(el.halfCourt ? [1] : [-1, 1]).map((dir) => (
        <Group key={dir} x={(dir * w) / 2} y={0}>
          <Rect
            x={dir < 0 ? 0 : -keyW}
            y={-keyH / 2}
            width={keyW}
            height={keyH}
            stroke={line}
            strokeWidth={lineWidth}
          />
          <Circle x={dir < 0 ? keyW : -keyW} y={0} radius={ftR} stroke={line} strokeWidth={lineWidth} />
          {/* 3-point arc — half circle facing inward */}
          <Arc
            x={0}
            y={0}
            innerRadius={threeR}
            outerRadius={threeR}
            angle={180}
            rotation={dir < 0 ? -90 : 90}
            stroke={line}
            strokeWidth={lineWidth}
          />
        </Group>
      ))}
    </>
  );
}

function PickleballCourtShape({
  el,
  pxPerFt,
  style,
}: {
  el: PickleballCourtElement;
  pxPerFt: number;
  style: CourtLayout["style"];
}) {
  const w = el.width * pxPerFt;
  const h = el.height * pxPerFt;
  const fill = el.surfaceColor ?? style.pickleballSurfaceColor;
  const line = el.lineColor ?? "#ffffff";
  const lineWidth = Math.max(1, Math.min(w, h) * 0.006);
  // Kitchen / non-volley zone — 7 ft from net on each side.
  const kitchenW = w * 0.16;
  return (
    <>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill={fill} />
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} stroke={line} strokeWidth={lineWidth} />
      {/* Net line (center) */}
      <Line points={[0, -h / 2, 0, h / 2]} stroke={line} strokeWidth={lineWidth * 1.2} />
      {/* Kitchen boundaries */}
      <Line points={[-kitchenW, -h / 2, -kitchenW, h / 2]} stroke={line} strokeWidth={lineWidth} />
      <Line points={[kitchenW, -h / 2, kitchenW, h / 2]} stroke={line} strokeWidth={lineWidth} />
      {/* Service court divider (between baseline and kitchen) */}
      <Line points={[-w / 2, 0, -kitchenW, 0]} stroke={line} strokeWidth={lineWidth} />
      <Line points={[kitchenW, 0, w / 2, 0]} stroke={line} strokeWidth={lineWidth} />
    </>
  );
}

function GenericCourtShape({
  el,
  pxPerFt,
  style,
}: {
  el: GenericCourtElement;
  pxPerFt: number;
  style: CourtLayout["style"];
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
  const fill = el.surfaceColor ?? defaultFill;
  const line = el.lineColor ?? "#ffffff";
  const lineWidth = Math.max(1, Math.min(w, h) * 0.005);

  return (
    <>
      <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill={fill} />
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
      <Text
        x={-w / 2}
        y={-h / 2 - 14}
        text={el.sport.toUpperCase()}
        fontSize={Math.max(9, w * 0.025)}
        fill={line}
      />
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
        />
      )}
      {el.arrow === "both" && (
        <Line
          points={[-len / 2, 0, -len / 2 + headSize, -headSize / 2, -len / 2 + headSize, headSize / 2]}
          closed
          fill={color}
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

function FenceRectShape({ el, pxPerFt }: { el: FenceRectElement; pxPerFt: number }) {
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
  const targetW = Math.min(180, canvasWidth * 0.14);
  const targetH = (img.naturalHeight / img.naturalWidth) * targetW;
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

// ─────────────────────────────────────────────────────────────────────
//  Grid + helpers
// ─────────────────────────────────────────────────────────────────────

// Plot dimension labels — drawn just outside the plot footprint so they
// don't compete with court markings but stay inside the PNG export. Top
// edge shows length, left edge shows width. Each label has tick marks at
// the corners + the dimension text. Uses a high-contrast white drop-shadow
// so they read on both grass and earth-coloured backgrounds.
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

  // Top: horizontal dimension line above the plot.
  const topY = plotOriginY - offset;
  // Dual-unit dimension labels (Option C — every exported PNG shows both
  // ft + m so customers never have to convert). Uses the international
  // foot: 1 ft = 0.3048 m.
  const lengthLabel = `${plotLengthFt} ft (${(plotLengthFt * 0.3048).toFixed(1)} m)`;
  // Left: vertical dimension line to the left of the plot.
  const leftX = plotOriginX - offset;
  const widthLabel = `${plotWidthFt} ft (${(plotWidthFt * 0.3048).toFixed(1)} m)`;

  return (
    <>
      {/* Top dimension — length */}
      <Line
        points={[plotOriginX, topY, plotOriginX + plotPxWidth, topY]}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />
      {/* End ticks on the length line */}
      <Line
        points={[plotOriginX, topY - tickLen / 2, plotOriginX, topY + tickLen / 2]}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />
      <Line
        points={[
          plotOriginX + plotPxWidth,
          topY - tickLen / 2,
          plotOriginX + plotPxWidth,
          topY + tickLen / 2,
        ]}
        stroke={lineColor}
        strokeWidth={lineWidth}
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

      {/* Left dimension — width */}
      <Line
        points={[leftX, plotOriginY, leftX, plotOriginY + plotPxHeight]}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />
      <Line
        points={[leftX - tickLen / 2, plotOriginY, leftX + tickLen / 2, plotOriginY]}
        stroke={lineColor}
        strokeWidth={lineWidth}
      />
      <Line
        points={[
          leftX - tickLen / 2,
          plotOriginY + plotPxHeight,
          leftX + tickLen / 2,
          plotOriginY + plotPxHeight,
        ]}
        stroke={lineColor}
        strokeWidth={lineWidth}
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
    const x = plotOriginX + ft * pxPerFt;
    lines.push(
      <Line
        key={`v${ft}`}
        points={[x, plotOriginY, x, plotOriginY + plotPxHeight]}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={1}
      />
    );
  }
  for (let ft = 0; ft <= plotWidthFt; ft += step) {
    const y = plotOriginY + ft * pxPerFt;
    lines.push(
      <Line
        key={`h${ft}`}
        points={[plotOriginX, y, plotOriginX + plotPxWidth, y]}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={1}
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
