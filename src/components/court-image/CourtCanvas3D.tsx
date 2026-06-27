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
} from "@/lib/court-image/schema";
import { aSideProps } from "@/lib/court-image/schema";

export type CourtCanvas3DHandle = {
  toDataURL: (pixelRatio?: number) => string | null;
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

    // Ground (earth) — extends beyond the plot for context.
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x9c845b });
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
        return renderer.domElement.toDataURL("image/png");
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
  }
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
