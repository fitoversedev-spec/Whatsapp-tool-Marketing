"use client";

// 3D renderer that consumes the same CourtLayout schema as the 2D canvas.
// The user designs in 2D (drag/resize/rotate everything), then in Step 3
// can toggle a 3D preview. Both reads from the SAME json — no second
// editor, no double bookkeeping.
//
// Rendering model:
//   • Plot is a horizontal ground plane around the courts (earth color)
//   • Each court / pitch element becomes a textured plane lying flat on
//     the ground. The texture is generated client-side from a canvas with
//     the appropriate markings (same drawing logic shape-for-shape as 2D).
//   • Goal posts get true 3D geometry (cylinders + crossbar + translucent
//     net) so the customer sees the goal stand up from the field.
//   • Dimension labels (80 ft / 60 ft) are sprites that always face the
//     camera — readable from every angle.
//
// Camera:
//   • Auto-orbit by default (cinematic showcase)
//   • Three preset views: top-down, isometric, eye-level
//
// PNG export: renderer.domElement.toDataURL("image/png"). We render
// synchronously before reading so the captured frame is current.

import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type {
  CourtLayout,
  CricketPitchElement,
  Element,
  FootballFieldElement,
  BasketballCourtElement,
  PickleballCourtElement,
  GenericCourtElement,
  GoalPostElement,
  NetElement,
  AnnotationElement,
  CustomRectElement,
  CustomLineElement,
  FenceRectElement,
  DugoutElement,
  BasketballHoopElement,
  HighlightZoneElement,
} from "@/lib/court-image/schema";
import { aSideProps } from "@/lib/court-image/schema";

export type CourtCanvas3DHandle = {
  toDataURL: (pixelRatio?: number) => string | null;
  // Records a 360° auto-orbit of the camera around the court and returns
  // an MP4 H.264 blob suitable for WhatsApp Cloud API. Uses WebCodecs +
  // mp4-muxer in-browser so we don't need ffmpeg.wasm. Calls onProgress
  // with a 0..1 fraction as frames encode so the wizard can show a bar.
  // Returns null on unsupported browsers or if the scene hasn't mounted.
  recordOrbitMP4: (options?: {
    durationSec?: number;
    fps?: number;
    onProgress?: (fraction: number) => void;
  }) => Promise<Blob | null>;
};

export type CourtView = "orbit" | "top" | "iso" | "side";

type Props = {
  layout: CourtLayout;
  canvasWidth: number;
  canvasHeight: number;
  handleRef?: MutableRefObject<CourtCanvas3DHandle | null>;
  view?: CourtView;
};

export default function CourtCanvas3D({
  layout,
  canvasWidth,
  canvasHeight,
  handleRef,
  view = "orbit",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationIdRef = useRef<number>(0);
  // Holds all dynamically built layout objects so we can dispose + rebuild
  // them when the layout JSON changes without recreating the scene.
  const courtGroupRef = useRef<THREE.Group | null>(null);
  // Keep the latest layout in a ref so the imperative MP4 recorder reads
  // up-to-date plot dimensions without needing to re-install the handle.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // Pre-load the watermark image so toDataURL/recordOrbitMP4 can
  // composite it onto the captured frame synchronously. Three.js renders
  // to WebGL; we copy that to a 2D canvas, draw the logo on top, and
  // export from there. This keeps the watermark out of the live 3D scene
  // (which would warp around the camera) while still baking it into the
  // sent media.
  const watermarkImgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const url = layout.style.watermarkUrl;
    if (!url) {
      watermarkImgRef.current = null;
      return;
    }
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      watermarkImgRef.current = img;
    };
    img.src = url;
    return () => {
      img.onload = null;
    };
  }, [layout.style.watermarkUrl]);

  // ───────────────────────────────────────────────
  //  One-time scene setup
  // ───────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0xc4dff5);
    scene.fog = new THREE.Fog(0xc4dff5, 110, 320);

    const camera = new THREE.PerspectiveCamera(45, canvasWidth / canvasHeight, 0.1, 1000);
    camera.position.set(80, 70, 80);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      // preserveDrawingBuffer so renderer.domElement.toDataURL captures
      // the latest frame. Without this, WebGL clears the back buffer
      // between commits and the snapshot comes back blank.
      preserveDrawingBuffer: true,
    });
    renderer.setSize(canvasWidth, canvasHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    // Lights — soft hemisphere + warm sun with shadow casting.
    const hemi = new THREE.HemisphereLight(0xfffaf0, 0x7a8a7a, 0.75);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff8e6, 1.0);
    sun.position.set(55, 90, 35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    // Ground (earth) — extends beyond the plot for context. Colour
    // reflects layout.style.groundFinish (concrete grey / grass green /
    // sand default) so 3D matches the 2D render — user asked for parity.
    const groundHex = (() => {
      // Explicit hex override wins (matches 2D resolveGroundColor).
      const override = layout.style.groundColorOverride;
      if (override) {
        const m = override.match(/^#?([0-9a-f]{6})$/i);
        if (m) return parseInt(m[1], 16);
      }
      const finish = layout.style.groundFinish;
      if (finish === "concrete") return 0x94a3b8;
      if (finish === "grass") return 0x5c7c3d;
      if (finish === "white") return 0xf1f3f5;
      if (layout.style.groundColor) {
        const m = layout.style.groundColor.match(/^#?([0-9a-f]{6})$/i);
        if (m) return parseInt(m[1], 16);
      }
      return 0x9c845b;
    })();
    const groundMat = new THREE.MeshLambertMaterial({ color: groundHex });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    // Orbit controls — drag to rotate, scroll to zoom.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 30;
    controls.maxDistance = 250;
    controls.target.set(0, 3, 0);
    controls.update();
    controlsRef.current = controls;

    // Animation loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationIdRef.current);
      controls.dispose();
      // Walk the scene and free GPU resources so we don't leak when the
      // wizard tab switches back to 2D and remounts the editor.
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) {
          (obj as THREE.Mesh).geometry.dispose();
        }
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose());
        } else if (mat) {
          (mat as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───────────────────────────────────────────────
  //  Rebuild court objects when layout changes
  // ───────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Drop the previous build, if any
    if (courtGroupRef.current) {
      scene.remove(courtGroupRef.current);
      disposeGroup(courtGroupRef.current);
      courtGroupRef.current = null;
    }

    const group = new THREE.Group();
    courtGroupRef.current = group;
    scene.add(group);

    // Centre the plot at world origin. plot-space (0,0) is bottom-left,
    // so we offset every element by -plot.lengthFt/2 horizontally and
    // -plot.widthFt/2 along Z.
    const cx = layout.plot.lengthFt / 2;
    const cy = layout.plot.widthFt / 2;

    // Sort by z so larger fields render under overlays (cricket pitch
    // should be on top of the football field).
    const sorted = [...layout.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

    sorted.forEach((el, i) => {
      const obj = buildElement(el, layout, i * 0.01);
      if (!obj) return;
      // Plot-space (x,y) → world (X, Z). Y is up, so plot Y maps to Z
      // with sign flip so "north" of the plot is -Z in world.
      obj.position.x = el.x - cx;
      obj.position.z = -(el.y - cy);
      obj.rotation.y = -THREE.MathUtils.degToRad(el.rotation);
      group.add(obj);
    });

    // Dimension sprites — drawn outside the plot footprint so they don't
    // overlap with court markings, but readable from any orbit angle.
    if (layout.style.showDimensions !== false) {
      const lenSprite = makeDimensionSprite(`${layout.plot.lengthFt} ft`);
      lenSprite.position.set(0, 0.5, -layout.plot.widthFt / 2 - 6);
      group.add(lenSprite);
      const widthSprite = makeDimensionSprite(`${layout.plot.widthFt} ft`);
      widthSprite.position.set(-layout.plot.lengthFt / 2 - 6, 0.5, 0);
      group.add(widthSprite);
    }
  }, [layout]);

  // ───────────────────────────────────────────────
  //  React to view-preset changes
  // ───────────────────────────────────────────────
  useEffect(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!controls || !camera) return;
    const presets: Record<CourtView, { pos: [number, number, number]; tgt: [number, number, number]; rot: boolean }> = {
      orbit: { pos: [85, 70, 85], tgt: [0, 3, 0], rot: true },
      top: { pos: [0.1, 130, 0.1], tgt: [0, 0, 0], rot: false },
      iso: { pos: [85, 70, 85], tgt: [0, 3, 0], rot: false },
      side: { pos: [0, 6, 78], tgt: [0, 4, 0], rot: false },
    };
    const v = presets[view];
    camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
    controls.target.set(v.tgt[0], v.tgt[1], v.tgt[2]);
    controls.autoRotate = v.rot;
    controls.autoRotateSpeed = 0.55;
    controls.update();
  }, [view]);

  // ───────────────────────────────────────────────
  //  Resize when canvas dims change
  // ───────────────────────────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;
    renderer.setSize(canvasWidth, canvasHeight);
    camera.aspect = canvasWidth / canvasHeight;
    camera.updateProjectionMatrix();
  }, [canvasWidth, canvasHeight]);

  // ───────────────────────────────────────────────
  //  Imperative handle for PNG export
  // ───────────────────────────────────────────────
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      toDataURL() {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        if (!renderer || !scene || !camera) return null;
        // Render one fresh frame before reading so the snapshot is current
        // (preserveDrawingBuffer + sync render = always-fresh capture).
        renderer.render(scene, camera);
        const wmImg = watermarkImgRef.current;
        const wmOpacity = layoutRef.current.style.watermarkOpacity ?? 0.9;
        if (!wmImg) {
          return renderer.domElement.toDataURL("image/png");
        }
        return compositeWithWatermark(renderer.domElement, wmImg, wmOpacity);
      },
      async recordOrbitMP4(options) {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        const currentLayout = layoutRef.current;
        if (!renderer || !scene || !camera) return null;
        // WebCodecs is the modern path. Firefox doesn't ship VideoEncoder
        // by default, but Chrome/Edge (the desktop sales workflow) do.
        if (typeof window.VideoEncoder === "undefined") {
          throw new Error(
            "Your browser doesn't support video encoding. Use Chrome or Edge to generate 3D videos."
          );
        }
        const duration = options?.durationSec ?? 6;
        const fps = options?.fps ?? 30;
        const totalFrames = Math.round(duration * fps);

        // Pause the live render loop + auto-orbit so our manual orbit owns
        // the camera for the recording window. Restored in finally below.
        const prevAutoRotate = controls?.autoRotate ?? false;
        if (controls) {
          controls.autoRotate = false;
          controls.enabled = false;
        }
        cancelAnimationFrame(animationIdRef.current);

        const canvas = renderer.domElement;
        const width = canvas.width;
        const height = canvas.height;
        // Even dimensions required for H.264 — round down if needed.
        const w = width - (width % 2);
        const h = height - (height % 2);

        const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
        const muxer = new Muxer({
          target: new ArrayBufferTarget(),
          video: { codec: "avc", width: w, height: h },
          fastStart: "in-memory",
        });

        // Build the watermark composite canvas once if a logo is set, so
        // we don't allocate one per frame. The encoder reads this canvas
        // each frame instead of the raw WebGL canvas so the watermark is
        // baked into every output frame.
        const wmImg = watermarkImgRef.current;
        const wmOpacity = layoutRef.current.style.watermarkOpacity ?? 0.9;
        const composite = wmImg ? document.createElement("canvas") : null;
        const compositeCtx = composite ? composite.getContext("2d") : null;
        if (composite && compositeCtx) {
          composite.width = w;
          composite.height = h;
        }

        let encoderError: unknown = null;
        const encoder = new window.VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
          error: (e) => {
            encoderError = e;
          },
        });
        encoder.configure({
          codec: "avc1.42E01E", // H.264 Baseline profile, level 3.0
          width: w,
          height: h,
          bitrate: 3_000_000,
          framerate: fps,
        });

        // Orbit at a comfortable radius — derived from plot extents so
        // small plots get a closer pass and large plots stay framed.
        const plotL = currentLayout.plot.lengthFt;
        const plotW = currentLayout.plot.widthFt;
        const radius = Math.max(plotL, plotW) * 1.1;
        const targetY = 0;

        try {
          for (let i = 0; i < totalFrames; i++) {
            if (encoderError) throw encoderError;
            const t = i / totalFrames;
            const angle = t * Math.PI * 2;
            camera.position.x = Math.sin(angle) * radius;
            camera.position.z = Math.cos(angle) * radius;
            camera.position.y = radius * 0.55;
            camera.lookAt(0, targetY, 0);
            renderer.render(scene, camera);

            // When a watermark is set, draw the WebGL canvas → 2D composite
            // and overlay the logo. The encoder then takes the composite
            // canvas as its source.
            let sourceCanvas: HTMLCanvasElement = canvas;
            if (composite && compositeCtx && wmImg) {
              compositeCtx.drawImage(canvas, 0, 0, w, h);
              drawWatermarkOn(compositeCtx, wmImg, w, h, wmOpacity);
              sourceCanvas = composite;
            }
            const frame = new window.VideoFrame(sourceCanvas, {
              timestamp: (i * 1_000_000) / fps,
              duration: 1_000_000 / fps,
            });
            // Force keyframes every second so seeking + thumbnails are
            // reasonable in WhatsApp's player.
            encoder.encode(frame, { keyFrame: i % fps === 0 });
            frame.close();
            if (options?.onProgress) options.onProgress((i + 1) / totalFrames);
            // Yield to the browser occasionally so the encoder backlog
            // can drain and the UI thread stays alive.
            if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0));
          }
          await encoder.flush();
          muxer.finalize();
          if (encoderError) throw encoderError;
          return new Blob([muxer.target.buffer], { type: "video/mp4" });
        } finally {
          // Resume the normal animation loop + restore controls regardless
          // of whether the recording succeeded.
          if (controls) {
            controls.enabled = true;
            controls.autoRotate = prevAutoRotate;
          }
          const tick = () => {
            animationIdRef.current = requestAnimationFrame(tick);
            if (controlsRef.current) controlsRef.current.update();
            rendererRef.current?.render(sceneRef.current!, cameraRef.current!);
          };
          tick();
        }
      },
    };
    return () => {
      if (handleRef) handleRef.current = null;
    };
  }, [handleRef]);

  return (
    <div
      ref={containerRef}
      style={{
        width: canvasWidth,
        height: canvasHeight,
        position: "relative",
        overflow: "hidden",
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Element → Three.js object
// ─────────────────────────────────────────────────────────────────────

function buildElement(el: Element, layout: CourtLayout, yOffset: number): THREE.Object3D | null {
  switch (el.type) {
    case "football-field":
      return makeFootballField(el, layout, yOffset);
    case "cricket-pitch":
      return makeCricketPitch(el, layout, yOffset);
    case "basketball-court":
      return makeBasketballCourt(el, layout, yOffset);
    case "pickleball-court":
      return makePickleballCourt(el, layout, yOffset);
    case "generic-court":
      return makeGenericCourt(el, layout, yOffset);
    case "goal-post":
      return makeGoalPost(el);
    case "net":
      return makeNet(el);
    case "annotation":
      return makeAnnotation(el);
    case "custom-rect":
      return makeCustomRect(el, yOffset);
    case "custom-line":
      return makeCustomLine(el, yOffset);
    case "fence-rect":
      return makeFenceRect(el);
    case "dugout":
      return makeDugout(el);
    case "basketball-hoop":
      return makeBasketballHoop(el);
    case "highlight-zone":
      return makeHighlightZone(el, yOffset);
  }
}

function makeHighlightZone(
  el: HighlightZoneElement,
  yOffset: number,
): THREE.Object3D {
  // 3D highlight zone — a translucent plane at the court surface. Same
  // rgba fill sales picked in 2D so the 3D preview matches. Sits just
  // above the court plane so it doesn't z-fight with the surface.
  const mat = new THREE.MeshBasicMaterial({
    color: parseColor(el.fill),
    transparent: true,
    opacity: parseAlpha(el.fill),
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shape = el.shape ?? "rect";
  if (
    shape === "ring" &&
    el.holeW != null &&
    el.holeH != null &&
    el.holeCx != null &&
    el.holeCy != null
  ) {
    // Plot-sized plane with a rectangular hole cut out (the court).
    // THREE.Shape supports holes natively.
    const outer = new THREE.Shape();
    const W2 = el.width / 2;
    const H2 = el.height / 2;
    outer.moveTo(-W2, -H2);
    outer.lineTo(W2, -H2);
    outer.lineTo(W2, H2);
    outer.lineTo(-W2, H2);
    outer.closePath();
    const hole = new THREE.Path();
    const hw = el.holeW / 2;
    const hh = el.holeH / 2;
    const hx = el.holeCx;
    const hy = el.holeCy;
    hole.moveTo(hx - hw, hy - hh);
    hole.lineTo(hx + hw, hy - hh);
    hole.lineTo(hx + hw, hy + hh);
    hole.lineTo(hx - hw, hy + hh);
    hole.closePath();
    outer.holes.push(hole);
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(outer), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = yOffset + 0.05;
    return mesh;
  }
  if (shape === "arc-right" || shape === "arc-left") {
    // Semi-circle geometry via THREE.Shape. el.width = radius X,
    // el.height = full diameter Y. Konva 2D draws the arc opening in
    // ±X; mirror that here so the 3D preview matches.
    //
    // absellipse(cx, cy, rx, ry, start, end, clockwise). Sweeping from
    // +PI/2 (top) to -PI/2 (bottom):
    //   clockwise=true  → passes through angle 0 (+x) → bulges +x  (arc-right)
    //   clockwise=false → passes through PI  (-x) → bulges -x       (arc-left)
    // The previous flag (dir<0) was inverted, so the 3D arc bulged
    // OUTWARD past the baseline instead of into the court.
    const s = new THREE.Shape();
    const rx = el.width;
    const ry = el.height / 2;
    const clockwise = shape === "arc-right";
    s.moveTo(0, ry);
    s.absellipse(0, 0, rx, ry, Math.PI / 2, -Math.PI / 2, clockwise, 0);
    s.lineTo(0, 0);
    s.closePath();
    const geom = new THREE.ShapeGeometry(s);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = yOffset + 0.05;
    return mesh;
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(el.width, el.height), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = yOffset + 0.05;
  return mesh;
}

function makeFootballField(
  el: FootballFieldElement,
  layout: CourtLayout,
  yOffset: number
): THREE.Object3D {
  const tex = footballTexture(el, layout);
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const geo = new THREE.PlaneGeometry(el.width, el.height);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = yOffset;
  mesh.receiveShadow = true;
  // Auto-add goals at the short ends (one per side) for visual realism.
  const group = new THREE.Group();
  group.add(mesh);
  const props = aSideProps(el.aSide);
  const goalW = el.height * props.goalWidthRatio;
  for (const dir of [-1, 1]) {
    const goal = buildPostsAndCrossbar(goalW, 8, 4);
    goal.position.x = (dir * el.width) / 2;
    if (dir > 0) goal.rotation.y = Math.PI;
    group.add(goal);
  }
  return group;
}

function makeCricketPitch(
  el: CricketPitchElement,
  layout: CourtLayout,
  yOffset: number
): THREE.Object3D {
  const tex = cricketTexture(el, layout);
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const geo = new THREE.PlaneGeometry(el.pitchLengthFt, el.pitchWidthFt);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  // Slightly raised so it z-fights cleanly above the football grass.
  mesh.position.y = yOffset + 0.04;
  mesh.receiveShadow = true;
  return mesh;
}

function makeBasketballCourt(
  el: BasketballCourtElement,
  layout: CourtLayout,
  yOffset: number
): THREE.Object3D {
  const tex = basketballTexture(el, layout);
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const geo = new THREE.PlaneGeometry(el.width, el.height);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = yOffset;
  mesh.receiveShadow = true;
  return mesh;
}

function makePickleballCourt(
  el: PickleballCourtElement,
  layout: CourtLayout,
  yOffset: number
): THREE.Object3D {
  const tex = pickleballTexture(el, layout);
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const geo = new THREE.PlaneGeometry(el.width, el.height);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = yOffset;
  mesh.receiveShadow = true;
  return mesh;
}

function makeGenericCourt(
  el: GenericCourtElement,
  layout: CourtLayout,
  yOffset: number
): THREE.Object3D {
  const tex = genericCourtTexture(el);
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const geo = new THREE.PlaneGeometry(el.width, el.height);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = yOffset;
  mesh.receiveShadow = true;
  return mesh;
}

function makeGoalPost(el: GoalPostElement): THREE.Object3D {
  return buildPostsAndCrossbar(el.widthFt, el.heightFt, el.depthFt);
}

function makeNet(el: NetElement): THREE.Object3D {
  const g = new THREE.Group();
  const postMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
  const postGeo = new THREE.CylinderGeometry(0.15, 0.15, el.heightFt, 8);
  const left = new THREE.Mesh(postGeo, postMat);
  left.position.set(-el.widthFt / 2, el.heightFt / 2, 0);
  left.castShadow = true;
  g.add(left);
  const right = new THREE.Mesh(postGeo.clone(), postMat);
  right.position.set(el.widthFt / 2, el.heightFt / 2, 0);
  right.castShadow = true;
  g.add(right);
  // Net membrane
  const netMat = new THREE.MeshBasicMaterial({
    color: 0xdddddd,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
  });
  const net = new THREE.Mesh(new THREE.PlaneGeometry(el.widthFt, el.heightFt), netMat);
  net.position.set(0, el.heightFt / 2, 0);
  g.add(net);
  return g;
}

function makeAnnotation(el: AnnotationElement): THREE.Object3D {
  // Render the text to a canvas texture, then a flat plane on the ground
  // (always-readable from top-down). The 2D fontSize is in plot ft; we
  // map it to a canvas resolution that keeps text crisp at any orbit
  // angle.
  const c = document.createElement("canvas");
  const padding = 12;
  const ctx = c.getContext("2d")!;
  const pxSize = Math.max(28, el.fontSize * 12);
  ctx.font = `600 ${pxSize}px system-ui, -apple-system, sans-serif`;
  const metrics = ctx.measureText(el.text);
  c.width = Math.ceil(metrics.width) + padding * 2;
  c.height = Math.ceil(pxSize * 1.6);
  const ctx2 = c.getContext("2d")!;
  ctx2.font = `600 ${pxSize}px system-ui, -apple-system, sans-serif`;
  if (el.background) {
    ctx2.fillStyle = el.background;
    roundRect(ctx2, 0, 0, c.width, c.height, pxSize * 0.3);
    ctx2.fill();
  }
  ctx2.fillStyle = el.color ?? "#0f172a";
  ctx2.textBaseline = "middle";
  ctx2.fillText(el.text, padding, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  const planeW = el.fontSize * (c.width / pxSize);
  const planeH = el.fontSize * (c.height / pxSize);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.06;
  return mesh;
}

function makeCustomRect(el: CustomRectElement, yOffset: number): THREE.Object3D {
  const mat = new THREE.MeshBasicMaterial({
    color: parseColor(el.fill ?? "rgba(15,23,42,0.15)"),
    transparent: true,
    opacity: parseAlpha(el.fill ?? "rgba(15,23,42,0.15)"),
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(el.width, el.height), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = yOffset + 0.02;
  return mesh;
}

function makeCustomLine(el: CustomLineElement, yOffset: number): THREE.Object3D {
  // Thin extruded box for visibility against the grass.
  const w = el.lengthFt;
  const h = (el.thickness ?? 3) / 8; // canvas-px → ft scale heuristic
  const mat = new THREE.MeshBasicMaterial({ color: parseColor(el.color ?? "#0f172a") });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = yOffset + 0.02;
  return mesh;
}

function makeFenceRect(el: FenceRectElement): THREE.Object3D {
  // Four vertical mesh walls around the perimeter. The mesh is a thin
  // translucent texture so depth shines through — reads as chain-link.
  const group = new THREE.Group();
  const color = parseColor(el.color ?? "#94a3b8");
  const matMesh = new THREE.MeshBasicMaterial({
    map: fenceMeshTexture(color),
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  // Posts at the corners
  const postMat = new THREE.MeshPhongMaterial({ color });
  const postGeo = new THREE.CylinderGeometry(0.18, 0.18, el.heightFt, 8);
  const corners: Array<[number, number]> = [
    [-el.width / 2, -el.height / 2],
    [el.width / 2, -el.height / 2],
    [-el.width / 2, el.height / 2],
    [el.width / 2, el.height / 2],
  ];
  corners.forEach(([px, py]) => {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(px, el.heightFt / 2, py);
    post.castShadow = true;
    group.add(post);
  });
  // Each wall is one mesh plane. Skip the centre of the gate edge so
  // there's a visible opening.
  const gateGap = el.hasGate ? Math.min(8, Math.max(el.width, el.height) * 0.12) : 0;
  const edgeKey = el.gateEdge ?? "south";

  function pushWall(
    edge: "north" | "south" | "east" | "west",
    spanFt: number,
    placeFn: (offsetFromCenter: number, length: number) => THREE.Vector3
  ) {
    // If this is the gate edge, leave a gap centred on the wall.
    if (edge === edgeKey && el.hasGate && spanFt > gateGap + 2) {
      const sideLen = (spanFt - gateGap) / 2;
      [-1, 1].forEach((dir) => {
        const offset = dir * (gateGap / 2 + sideLen / 2);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sideLen, el.heightFt), matMesh);
        mesh.position.copy(placeFn(offset, sideLen));
        mesh.rotation.y = edge === "east" || edge === "west" ? Math.PI / 2 : 0;
        group.add(mesh);
      });
    } else {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spanFt, el.heightFt), matMesh);
      mesh.position.copy(placeFn(0, spanFt));
      mesh.rotation.y = edge === "east" || edge === "west" ? Math.PI / 2 : 0;
      group.add(mesh);
    }
  }
  pushWall("north", el.width, (off) => new THREE.Vector3(off, el.heightFt / 2, -el.height / 2));
  pushWall("south", el.width, (off) => new THREE.Vector3(off, el.heightFt / 2, el.height / 2));
  pushWall("east", el.height, (off) => new THREE.Vector3(el.width / 2, el.heightFt / 2, off));
  pushWall("west", el.height, (off) => new THREE.Vector3(-el.width / 2, el.heightFt / 2, off));
  return group;
}

function makeDugout(el: DugoutElement): THREE.Object3D {
  // A box with a slightly tilted roof. The "open side" faces +X by
  // default (parent rotation handles re-orientation in the wizard).
  const group = new THREE.Group();
  const baseH = 4; // ft tall walls
  const roofH = 1.5;
  const wallMat = new THREE.MeshPhongMaterial({ color: parseColor(el.benchColor ?? "#cbd5e1") });
  const roofMat = new THREE.MeshPhongMaterial({ color: parseColor(el.roofColor ?? "#475569") });
  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(el.width, el.height), wallMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.03;
  group.add(floor);
  // Back wall
  const backH = baseH;
  const back = new THREE.Mesh(new THREE.BoxGeometry(el.width, backH, 0.4), wallMat);
  back.position.set(0, backH / 2, -el.height / 2);
  back.castShadow = true;
  group.add(back);
  // Side walls (shorter so the open side is taller)
  [-1, 1].forEach((sideDir) => {
    const side = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, baseH * 0.85, el.height),
      wallMat
    );
    side.position.set((sideDir * el.width) / 2, (baseH * 0.85) / 2, 0);
    side.castShadow = true;
    group.add(side);
  });
  // Bench (a chunky low platform along the back wall)
  const benchH = 1.2;
  const benchDepth = Math.min(2, el.height * 0.45);
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(el.width - 0.6, benchH, benchDepth),
    new THREE.MeshPhongMaterial({ color: parseColor("#94a3b8") })
  );
  bench.position.set(0, benchH / 2 + 0.05, -el.height / 2 + benchDepth / 2 + 0.3);
  bench.castShadow = true;
  group.add(bench);
  // Roof — tilts down towards the open side so rain runs off
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(el.width + 0.8, 0.3, el.height + 0.8),
    roofMat
  );
  roof.position.set(0, baseH + roofH / 2, 0);
  roof.rotation.x = -0.15; // slight tilt
  roof.castShadow = true;
  group.add(roof);
  // Open-side orientation — rotate the whole dugout so the opening faces
  // the requested direction.
  const openRotY: Record<DugoutElement["openSide"], number> = {
    north: Math.PI,
    south: 0,
    east: -Math.PI / 2,
    west: Math.PI / 2,
  };
  group.rotation.y = openRotY[el.openSide];
  return group;
}

function makeBasketballHoop(el: BasketballHoopElement): THREE.Object3D {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshPhongMaterial({
    color: parseColor(el.color ?? "#0f172a"),
    shininess: 40,
  });
  const rimMat = new THREE.MeshBasicMaterial({
    color: parseColor(el.rimColor ?? "#ef4444"),
  });
  // Pole — vertical cylinder behind the backboard
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.3, el.poleHeightFt, 12),
    poleMat
  );
  pole.position.set(0, el.poleHeightFt / 2, 0);
  pole.castShadow = true;
  group.add(pole);
  // Arm extending forward to hold the backboard
  const armLen = 2;
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.25, armLen),
    poleMat
  );
  arm.position.set(0, el.poleHeightFt - 0.5, armLen / 2);
  arm.castShadow = true;
  group.add(arm);
  // Backboard — white rectangle with a colored target box
  const bbW = el.backboardWidthFt;
  const bbH = bbW * 0.6;
  const bb = new THREE.Mesh(
    new THREE.BoxGeometry(bbW, bbH, 0.1),
    new THREE.MeshPhongMaterial({ color: 0xfafafa })
  );
  bb.position.set(0, el.poleHeightFt - 0.5, armLen);
  bb.castShadow = true;
  group.add(bb);
  // Target square outline on the backboard
  const target = new THREE.Mesh(
    new THREE.PlaneGeometry(bbW * 0.3, bbH * 0.4),
    new THREE.MeshBasicMaterial({
      color: 0xff5555,
      transparent: true,
      opacity: 0.25,
    })
  );
  target.position.set(0, el.poleHeightFt - 0.7, armLen + 0.06);
  group.add(target);
  // Rim — a torus in front of the backboard
  const rimR = 0.75;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(rimR, 0.08, 8, 24),
    rimMat
  );
  rim.position.set(0, el.poleHeightFt - 1.2, armLen + rimR);
  rim.rotation.x = Math.PI / 2;
  rim.castShadow = true;
  group.add(rim);
  // Net (translucent)
  const netMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
  });
  const net = new THREE.Mesh(
    new THREE.CylinderGeometry(rimR * 0.8, rimR * 0.3, 1, 12, 1, true),
    netMat
  );
  net.position.set(0, el.poleHeightFt - 1.7, armLen + rimR);
  group.add(net);
  return group;
}

// Generates a chain-link mesh-pattern texture for fence walls.
function fenceMeshTexture(color: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
  const hex = "#" + color.toString(16).padStart(6, "0");
  ctx.strokeStyle = hex;
  ctx.lineWidth = 1.5;
  const step = 16;
  ctx.globalAlpha = 0.9;
  for (let i = -c.width; i < c.width * 2; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + c.height, c.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i, c.height);
    ctx.lineTo(i + c.height, 0);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 2);
  tex.anisotropy = 4;
  return tex;
}

function buildPostsAndCrossbar(widthFt: number, heightFt: number, depthFt: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color: 0xf2f2f2, shininess: 40 });
  const postGeo = new THREE.CylinderGeometry(0.32, 0.32, heightFt, 14);
  const left = new THREE.Mesh(postGeo, mat);
  left.position.set(0, heightFt / 2, -widthFt / 2);
  left.castShadow = true;
  g.add(left);
  const right = new THREE.Mesh(postGeo.clone(), mat);
  right.position.set(0, heightFt / 2, widthFt / 2);
  right.castShadow = true;
  g.add(right);
  const cross = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, widthFt, 14),
    mat
  );
  cross.rotation.x = Math.PI / 2;
  cross.position.set(0, heightFt, 0);
  cross.castShadow = true;
  g.add(cross);
  // Back posts + translucent net for that classic goal silhouette
  const backPostGeo = new THREE.CylinderGeometry(0.22, 0.22, heightFt - 1, 10);
  const bl = new THREE.Mesh(backPostGeo, mat);
  bl.position.set(-depthFt, (heightFt - 1) / 2, -widthFt / 2);
  bl.castShadow = true;
  g.add(bl);
  const br = new THREE.Mesh(backPostGeo.clone(), mat);
  br.position.set(-depthFt, (heightFt - 1) / 2, widthFt / 2);
  br.castShadow = true;
  g.add(br);
  const netMat = new THREE.MeshBasicMaterial({
    color: 0xdedede,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
  });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(widthFt, heightFt - 1), netMat);
  back.position.set(-depthFt, (heightFt - 1) / 2, 0);
  back.rotation.y = Math.PI / 2;
  g.add(back);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(widthFt, depthFt), netMat);
  top.position.set(-depthFt / 2, heightFt - 0.15, 0);
  top.rotation.x = Math.PI / 2;
  g.add(top);
  const sideGeo = new THREE.PlaneGeometry(depthFt, heightFt - 0.6);
  const sl = new THREE.Mesh(sideGeo, netMat);
  sl.position.set(-depthFt / 2, (heightFt - 0.6) / 2, -widthFt / 2);
  g.add(sl);
  const sr = new THREE.Mesh(sideGeo.clone(), netMat);
  sr.position.set(-depthFt / 2, (heightFt - 0.6) / 2, widthFt / 2);
  g.add(sr);
  return g;
}

// ─────────────────────────────────────────────────────────────────────
//  Texture builders — drawn to off-screen canvases, wrapped in
//  CanvasTexture and used as the diffuse map on the corresponding plane.
//  Resolution scales with the element's dimensions so a 100 ft football
//  pitch and a 22 ft pickleball court both end up sharp.
// ─────────────────────────────────────────────────────────────────────

function footballTexture(el: FootballFieldElement, layout: CourtLayout): THREE.CanvasTexture {
  const aspect = el.width / el.height;
  const w = 2000;
  const h = Math.round(w / aspect);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const grassColor = el.grassColor ?? layout.style.grassColor;
  const lineColor = el.lineColor ?? layout.style.lineColor;
  const lineWidth = Math.max(4, w * 0.0045);
  // Mowed-stripe pattern
  const stripes = 10;
  const stripeW = w / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? grassColor : darken(grassColor, 0.1);
    ctx.fillRect(i * stripeW, 0, stripeW, h);
  }
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const props = aSideProps(el.aSide);
  const inset = lineWidth;
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  const centerR = Math.min(w, h) * props.centerCircleRadiusRatio;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, centerR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = lineColor;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, lineWidth * 1.2, 0, Math.PI * 2);
  ctx.fill();
  // Penalty boxes
  const pbW = w * props.penaltyBoxWidthRatio;
  const pbH = h * props.penaltyBoxHeightRatio;
  ctx.strokeRect(0, (h - pbH) / 2, pbW, pbH);
  ctx.strokeRect(w - pbW, (h - pbH) / 2, pbW, pbH);
  // Goal areas
  const gaW = w * props.goalAreaWidthRatio;
  const gaH = h * props.goalAreaHeightRatio;
  ctx.strokeRect(0, (h - gaH) / 2, gaW, gaH);
  ctx.strokeRect(w - gaW, (h - gaH) / 2, gaW, gaH);
  // Penalty spots + arcs
  const psOff = pbW * 0.55;
  ctx.beginPath();
  ctx.arc(psOff, h / 2, lineWidth * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(w - psOff, h / 2, lineWidth * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(psOff, h / 2, centerR * 0.85, -0.7, 0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w - psOff, h / 2, centerR * 0.85, Math.PI - 0.7, Math.PI + 0.7);
  ctx.stroke();
  // Corner arcs
  const cornerR = Math.min(w, h) * 0.018;
  [
    [0, 0, 0, Math.PI / 2],
    [w, 0, Math.PI / 2, Math.PI],
    [0, h, -Math.PI / 2, 0],
    [w, h, Math.PI, Math.PI * 1.5],
  ].forEach(([x, y, s, e]) => {
    ctx.beginPath();
    ctx.arc(x as number, y as number, cornerR, s as number, e as number);
    ctx.stroke();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

function cricketTexture(el: CricketPitchElement, layout: CourtLayout): THREE.CanvasTexture {
  const aspect = el.pitchLengthFt / el.pitchWidthFt;
  const h = 256;
  const w = Math.round(h * aspect);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const fill = el.pitchColor ?? layout.style.cricketPitchColor;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, darken(fill, 0.08));
  grad.addColorStop(0.5, fill);
  grad.addColorStop(1, darken(fill, 0.12));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const mark = el.markingColor ?? "#fff3df";
  ctx.strokeStyle = mark;
  ctx.lineWidth = 3;
  const popDist = Math.min(w * 0.12, 36);
  ctx.beginPath();
  ctx.moveTo(popDist, 0);
  ctx.lineTo(popDist, h);
  ctx.moveTo(w - popDist, 0);
  ctx.lineTo(w - popDist, h);
  ctx.stroke();
  // Stumps (3 lines each side)
  ctx.fillStyle = mark;
  [popDist, w - popDist].forEach((sx) => {
    [-14, -4, 6].forEach((off) => ctx.fillRect(sx + off - 1, h * 0.38, 2, h * 0.24));
  });
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

function basketballTexture(el: BasketballCourtElement, layout: CourtLayout): THREE.CanvasTexture {
  const aspect = el.width / el.height;
  const h = 800;
  const w = Math.round(h * aspect);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = el.surfaceColor ?? layout.style.basketballSurfaceColor;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = el.lineColor ?? "#fff5e6";
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, w, h);
  if (!el.halfCourt) {
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.07, 0, Math.PI * 2);
    ctx.stroke();
  }
  const keyW = w * 0.18;
  const keyH = h * 0.32;
  const ftR = Math.min(w, h) * 0.07;
  const threeR = Math.min(w, h) * 0.34;
  (el.halfCourt ? [1] : [-1, 1]).forEach((dir) => {
    const cx = dir < 0 ? 0 : w;
    const keyX = dir < 0 ? 0 : w - keyW;
    ctx.strokeRect(keyX, (h - keyH) / 2, keyW, keyH);
    ctx.beginPath();
    ctx.arc(dir < 0 ? keyW : w - keyW, h / 2, ftR, 0, Math.PI * 2);
    ctx.stroke();
    // 3-point arc
    ctx.beginPath();
    ctx.arc(cx, h / 2, threeR, dir < 0 ? -Math.PI / 2 : Math.PI / 2, dir < 0 ? Math.PI / 2 : -Math.PI / 2, false);
    ctx.stroke();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

function pickleballTexture(el: PickleballCourtElement, layout: CourtLayout): THREE.CanvasTexture {
  const aspect = el.width / el.height;
  const h = 600;
  const w = Math.round(h * aspect);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = el.surfaceColor ?? layout.style.pickleballSurfaceColor;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = el.lineColor ?? "#ffffff";
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, w, h);
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  const kitchen = w * 0.16;
  ctx.beginPath();
  ctx.moveTo(w / 2 - kitchen, 0);
  ctx.lineTo(w / 2 - kitchen, h);
  ctx.moveTo(w / 2 + kitchen, 0);
  ctx.lineTo(w / 2 + kitchen, h);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w / 2 - kitchen, h / 2);
  ctx.moveTo(w / 2 + kitchen, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

function genericCourtTexture(el: GenericCourtElement): THREE.CanvasTexture {
  const aspect = el.width / el.height;
  const h = 600;
  const w = Math.round(h * aspect);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = el.surfaceColor ?? "#5a8a6c";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = el.lineColor ?? "#ffffff";
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, w, h);
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

// ─────────────────────────────────────────────────────────────────────
//  Dimension labels — canvas-textured Three.js sprites
// ─────────────────────────────────────────────────────────────────────

function makeDimensionSprite(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 384;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  // Pill background for legibility against any orbit angle
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  roundRect(ctx, 0, 0, c.width, c.height, 32);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.font = "600 64px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(12, 4, 1);
  return sp;
}

// ─────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────

function disposeGroup(group: THREE.Object3D) {
  group.traverse((obj) => {
    if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
    const mat = (obj as THREE.Mesh).material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) (mat as THREE.Material).dispose();
  });
}

function darken(hexOrRgb: string, amount: number): string {
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
  return `rgb(${r},${g},${b})`;
}

function parseColor(input: string): number {
  if (input.startsWith("#")) {
    return parseInt(input.slice(1), 16);
  }
  const m = input.match(/rgba?\(([^)]+)\)/);
  if (!m) return 0x222222;
  const [r, g, b] = m[1].split(",").map((p) => parseInt(p.trim()));
  return (r << 16) | (g << 8) | b;
}

function parseAlpha(input: string): number {
  const m = input.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
  return parts.length === 4 ? parts[3] : 1;
}

// Composites the WebGL canvas onto a 2D canvas, overlays the watermark in
// the bottom-right corner, and returns the result as a PNG dataURL.
function compositeWithWatermark(
  webgl: HTMLCanvasElement,
  wmImg: HTMLImageElement,
  opacity: number
): string {
  const composite = document.createElement("canvas");
  composite.width = webgl.width;
  composite.height = webgl.height;
  const ctx = composite.getContext("2d")!;
  ctx.drawImage(webgl, 0, 0);
  drawWatermarkOn(ctx, wmImg, webgl.width, webgl.height, opacity);
  return composite.toDataURL("image/png");
}

// Bottom-right watermark on a 2D canvas context — same placement +
// pill-background style as the 2D Konva canvas so 2D and 3D exports look
// branded identically.
function drawWatermarkOn(
  ctx: CanvasRenderingContext2D,
  wmImg: HTMLImageElement,
  cw: number,
  ch: number,
  opacity: number
) {
  const targetW = Math.min(220, cw * 0.16);
  const targetH = (wmImg.naturalHeight / wmImg.naturalWidth) * targetW;
  const margin = Math.max(14, cw * 0.015);
  const padding = Math.max(8, cw * 0.008);
  const pillX = cw - targetW - margin - padding * 2;
  const pillY = ch - targetH - margin - padding * 2;
  const pillW = targetW + padding * 2;
  const pillH = targetH + padding * 2;
  // White rounded pill behind the logo for legibility
  ctx.save();
  ctx.globalAlpha = opacity * 0.78;
  roundRect(ctx, pillX, pillY, pillW, pillH, 6);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
  // Logo itself
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(wmImg, pillX + padding, pillY + padding, targetW, targetH);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
