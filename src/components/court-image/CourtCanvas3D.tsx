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
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
// Post-processing pipeline (P3-01 / P3-07). All present in three r0.185's
// examples/jsm. The composer drives the EXISTING on-demand render loop —
// see the setup effect — so idle static views still stop rendering.
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
// T1-3 colour-grade / vignette pass appended after OutputPass. ShaderPass is a
// tiny full-screen quad pass present in three r0.185's examples/jsm.
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
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
  FloodlightElement,
  SeatingElement,
  ScoreboardElement,
  SightScreenElement,
  CornerFlagElement,
  GateElement,
  CenterLogoElement,
  SurfaceFinish as PlotSurfaceFinish,
} from "@/lib/court-image/schema";
import {
  aSideProps,
  isTurfSurface,
  isTiledSurface,
  isPvcSurface,
  SURFACE_SOLID_COLOR,
  FINISH_MATERIAL,
} from "@/lib/court-image/schema";

// Max anisotropic filtering the GPU supports. Seeded to a safe 8 and raised to
// the true hardware max (usually 16) once the renderer exists, then used on the
// hero court/ground surface textures so flooring + mow stripes stay crisp at
// grazing camera angles instead of smearing to a blurry mush.
let MAX_ANISOTROPY = 8;

export type CourtCanvas3DHandle = {
  toDataURL: (pixelRatio?: number) => string | null;
  // A straight overhead "drone" still (camera looking straight down, framing
  // the whole plot). Used for the PDF's 3D view. Restores the live camera.
  captureTopDown: (pixelRatio?: number) => string | null;
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
  // Captures N still frames of a horizontal 360° spin (fixed pitch) as
  // JPEG data URLs. Feeds the self-contained drag-to-rotate HTML file so
  // the customer can spin the court in any phone browser, offline — no
  // hosting, no 3D engine, just image-swapping on drag.
  captureSpinFrames: (options?: {
    frames?: number;
    quality?: number;
    maxWidth?: number;
    onProgress?: (fraction: number) => void;
  }) => Promise<string[] | null>;
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
  // Post-processing composer (GTAO + AA + tone-map). Once built, ALL live +
  // exported frames render through it (via composerRef in the export handlers)
  // so the deliverables get the same "product render" AO/AA the preview shows.
  const composerRef = useRef<EffectComposer | null>(null);
  // The sun DirectionalLight + its world direction — kept in refs so the
  // per-layout rebuild can fit the shadow frustum to the plot bounds (P3-05).
  const sunRef = useRef<THREE.DirectionalLight | null>(null);
  const sunDirRef = useRef<THREE.Vector3>(new THREE.Vector3());
  // P6-01: the hemisphere + fill lights + sky dome, kept in refs so the
  // layout-rebuild effect can dim them for evening/night (floodlit scenes).
  const hemiRef = useRef<THREE.HemisphereLight | null>(null);
  const fillRef = useRef<THREE.DirectionalLight | null>(null);
  const skyRef = useRef<Sky | null>(null);
  const animationIdRef = useRef<number>(0);
  // On-demand rendering. The animation loop calls the (expensive) WebGL
  // render ONLY when something actually changed: a control move (drag / zoom /
  // damping), an auto-orbit frame, or a layout / view / resize invalidate.
  // An idle static view (top / iso / side with no interaction) stops rendering
  // entirely instead of redrawing an identical shadow-mapped frame at 60fps.
  // `needsRenderRef` is the dirty flag; `animateRef` lets the imperative export
  // handlers resume this same loop instead of spinning up a second always-on
  // render loop.
  const needsRenderRef = useRef(true);
  const animateRef = useRef<(() => void) | null>(null);
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
    // T1-1 — studio gradient backdrop (light top → soft mid → deeper bottom)
    // instead of a flat fill, so the scene reads like a soft product-shot
    // sweep. Regenerated/tinted per time-of-day in the layout effect. Additive:
    // if the CanvasTexture can't build we fall back to today's flat sky-blue
    // colour (also the safety fill before the first paint).
    scene.background = makeBackdropTexture(0x8fb8de) ?? new THREE.Color(0x8fb8de);
    // Ground haze so the flat plane's far edge melts into the horizon
    // instead of ending in a hard line. The Sky dome is a fog-less
    // ShaderMaterial, so this only affects the ground + court objects.
    scene.fog = new THREE.Fog(0xcbd9e6, 260, 900);

    // Near plane pushed 0.1 → 0.6 (P3-06): the whole scene lives out at
    // 10s–100s of feet, so a tight near plane wastes depth-buffer precision
    // and causes the co-planar court/overlay planes to z-fight at grazing
    // angles. A larger near also sharpens GTAO depth reconstruction. Nothing
    // the camera ever gets within 0.6 ft of, so nothing clips.
    // T1-4 — product-shot focal length. fov 42 → 34 flattens perspective
    // distortion for a more premium "hero still" look (a longer lens). The view
    // presets below pull the camera back proportionally so the court still
    // fills the frame at every plot size; captureTopDown solves its height from
    // camera.fov analytically, so it adapts automatically.
    const camera = new THREE.PerspectiveCamera(34, canvasWidth / canvasHeight, 0.6, 6000);
    camera.position.set(96, 84, 96);
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
    // Filmic tone mapping + sRGB output = photographic contrast and
    // colour instead of the flat, washed-out look of raw linear output.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Slightly under 1.0 so the bright day sky + sun don't wash the surface out.
    renderer.toneMappingExposure = 0.85;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;
    MAX_ANISOTROPY = renderer.capabilities.getMaxAnisotropy();
    container.appendChild(renderer.domElement);

    // Physical sky dome with an atmospheric horizon + real sun position.
    // Built FIRST so the image-based lighting below can be baked from THIS
    // actual sky rather than a neutral studio box — metal posts + glossy
    // acrylic then reflect the same blue sky + warm sun the customer sees.
    const SUN_ELEV = 34 * (Math.PI / 180);
    const SUN_AZI = 128 * (Math.PI / 180);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(
      1,
      Math.PI / 2 - SUN_ELEV,
      SUN_AZI,
    );
    sunDirRef.current.copy(sunDir);
    const sky = new Sky();
    sky.scale.setScalar(5000);
    const su = sky.material.uniforms;
    su.turbidity.value = 4;
    su.rayleigh.value = 2.6; // deeper, clearer blue (was washing out pale)
    su.mieCoefficient.value = 0.004;
    su.mieDirectionalG.value = 0.82;
    su.sunPosition.value.copy(sunDir);
    scene.add(sky);
    skyRef.current = sky;

    // Image-based ambient light baked from the in-scene Sky dome via PMREM.
    // This is what makes PBR (MeshStandard) surfaces read as real — the sky
    // supplies soft blue fill + a warm sun probe so metal + glossy surfaces
    // catch a genuine sky reflection instead of a flat grey studio. `far`
    // must clear the sky dome (scale 5000 → faces at ~2500) or the cube
    // capture clips to nothing; only the (fog-less) Sky is in the scene at
    // this point so the probe is clean. Generated once, then freed.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyEnvRT = pmrem.fromScene(scene, 0.04, 1, 10000);
    scene.environment = skyEnvRT.texture;
    // Sky IBL kept very low ("remove the sky light" feedback); the day profile
    // below re-applies it. (Overridden per time-of-day at rebuild.)
    scene.environmentIntensity = 0.1;

    // Lights — the env map does the ambient fill now, so the hemisphere
    // is dialled way down; the sun stays strong for crisp shadows and
    // specular highlights, aligned with the sky's sun.
    const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x55603f, 0.35);
    scene.add(hemi);
    hemiRef.current = hemi;
    const sun = new THREE.DirectionalLight(0xfff2d6, 2.6);
    sun.position.copy(sunDir).multiplyScalar(160);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -140;
    sun.shadow.camera.right = 140;
    sun.shadow.camera.top = 140;
    sun.shadow.camera.bottom = -140;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 520;
    sun.shadow.bias = -0.00018;
    sun.shadow.normalBias = 0.6;
    scene.add(sun);
    sunRef.current = sun;
    // Cool sky-side fill from the opposite direction so shadowed faces
    // aren't dead black — mimics bounced skylight.
    const fill = new THREE.DirectionalLight(0x9db4d6, 0.35);
    fill.position.set(-sunDir.x * 120, 80, -sunDir.z * 120);
    scene.add(fill);
    fillRef.current = fill;

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
    const groundMat = new THREE.MeshStandardMaterial({
      color: groundHex,
      roughness: 0.98,
      metalness: 0.0,
    });
    // Give grass/sand a faint tonal break-up so the huge plane doesn't
    // read as flat plastic; concrete/white stay clean. The map carries
    // the colour, so the base colour becomes white to avoid double-tint.
    const finishNow = layout.style.groundFinish;
    if (finishNow !== "concrete" && finishNow !== "white") {
      groundMat.map = groundNoiseTexture(groundHex);
      groundMat.map.colorSpace = THREE.SRGBColorSpace;
      groundMat.color.set(0xffffff);
    }
    // Micro-relief normal (P3-02) so grazing sun rakes across the earth
    // instead of reading as flat plastic. Grass = pile, sand/concrete = fine
    // grain, white stays clean-flat.
    if (finishNow === "grass") {
      groundMat.normalMap = makeSurfaceNormalTexture("turf", 60, 60);
      groundMat.normalScale = new THREE.Vector2(0.5, 0.5);
    } else if (finishNow !== "white") {
      groundMat.normalMap = makeSurfaceNormalTexture("grain", 60, 60);
      const ns = finishNow === "concrete" ? 0.22 : 0.4;
      groundMat.normalScale = new THREE.Vector2(ns, ns);
    }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    // The PMREM texture is baked into scene.environment; the generator
    // itself is no longer needed.
    pmrem.dispose();

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

    // ── Post-processing composer (P3-01 + P3-07) ───────────────────────
    // Ground-contact ambient occlusion + anti-aliasing layered on top of the
    // existing on-demand loop. The composer's colour target is created with
    // { samples: 4 } so the renderer's MSAA survives INTO the post chain —
    // without it, GTAO/bloom would read a jaggy, single-sampled buffer and
    // every geometry edge would alias. OutputPass performs the FINAL ACES
    // tone-map + sRGB encode; the intermediate targets stay linear (three
    // uses NoToneMapping whenever it renders into a render target, verified in
    // the r0.185 source), so tone mapping is applied exactly ONCE and is never
    // doubled up with the renderer's own output stage. The renderer keeps its
    // toneMapping/outputColorSpace set precisely because OutputPass reads them.
    const caps = renderer.capabilities;
    const cores =
      (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 8;
    // Low-end fallback: no WebGL2 (→ no MSAA render targets), no 4× MSAA, or a
    // 1–2 core machine. These devices skip the (expensive) GTAO GBuffer +
    // denoise passes and the bloom, and get SMAA-only AA instead.
    const lowEnd = !caps.isWebGL2 || caps.maxSamples < 4 || cores <= 2;
    const dpr = renderer.getPixelRatio();
    const bufW = Math.max(2, Math.round(canvasWidth * dpr));
    const bufH = Math.max(2, Math.round(canvasHeight * dpr));
    const composerTarget = new THREE.WebGLRenderTarget(bufW, bufH, {
      type: THREE.HalfFloatType, // HDR headroom so bloom/tone-map don't clip
      samples: 4, // MSAA — resolved on read, survives the composer
    });
    const composer = new EffectComposer(renderer, composerTarget);
    // Normalise internal sizes to the drawing buffer (constructor seeds
    // _width from the target size; setSize re-applies pixelRatio cleanly).
    composer.setSize(canvasWidth, canvasHeight);
    composer.addPass(new RenderPass(scene, camera));
    if (!lowEnd) {
      // GTAO ambient-occlusion REMOVED (root cause of the "black box"): its
      // occlusion GBuffer rendered the flat billboard dimension labels (and the
      // alpha-mapped nets) as SOLID quads and darkened the ground behind them.
      // Grounding now comes from the sun's real cast shadows + the sky IBL.
      // Very subtle HDR bloom (P3-07). Threshold sits just ABOVE 1.0 so the
      // white court lines (linear ~1.0 pre-tone-map) never bloom — only true
      // HDR highlights (sun specular on metal posts/rims) glow softly.
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(bufW, bufH),
        0.18, // strength (gentle)
        0.5, // radius
        1.6, // threshold (linear HDR) — only true highlights (sun specular on
        //      metal/rims) glow; broad lit turf/ground must NOT bloom.
      );
      composer.addPass(bloom);
    } else {
      composer.addPass(new SMAAPass());
    }
    composer.addPass(new OutputPass());
    // T1-3 — colour grade + vignette. ONE final full-screen pass after the
    // OutputPass (which has already done ACES tone-map + sRGB encode), so this
    // grades the display-space image: a subtle S-curve for contrast, a small
    // saturation lift, and a soft radial vignette that draws the eye to the
    // court. Gated by the same !lowEnd flag as bloom (skipped on weak GPUs).
    // Additive: if it isn't added the pipeline is exactly today's chain.
    if (!lowEnd) {
      composer.addPass(new ShaderPass(gradeVignetteShader()));
    }
    composerRef.current = composer;
    // Shared render entry point for the on-demand loop: composer when present,
    // otherwise a direct render (safety only). The export handlers render
    // through composerRef the same way so preview + deliverables match.
    const renderFrame = () => {
      const r = rendererRef.current;
      const s = sceneRef.current;
      const cam = cameraRef.current;
      if (!r || !s || !cam) return;
      const cmp = composerRef.current;
      if (cmp) cmp.render();
      else r.render(s, cam);
    };

    // On-demand render loop. controls.update() is cheap (matrix math only) and
    // must run every frame so damping + auto-orbit keep advancing; the
    // expensive renderer.render() fires only while auto-orbit is on or the
    // dirty flag is set. OrbitControls dispatches 'change' whenever the camera
    // actually moves (drag, zoom, pan, damping settle), so marking dirty there
    // captures every interactive + inertial frame without rendering when idle.
    const invalidate = () => {
      needsRenderRef.current = true;
    };
    controls.addEventListener("change", invalidate);
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      const c = controlsRef.current;
      const r = rendererRef.current;
      const s = sceneRef.current;
      const cam = cameraRef.current;
      if (!r || !s || !cam) return;
      if (c) c.update();
      if ((c && c.autoRotate) || needsRenderRef.current) {
        renderFrame();
        needsRenderRef.current = false;
      }
    };
    animateRef.current = animate;
    animate();

    return () => {
      cancelAnimationFrame(animationIdRef.current);
      animateRef.current = null;
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      // Walk the scene and free GPU resources so we don't leak when the
      // wizard tab switches back to 2D and remounts the editor.
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) {
          (obj as THREE.Mesh).geometry.dispose();
        }
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) {
          mat.forEach(disposeMaterial);
        } else if (mat) {
          disposeMaterial(mat as THREE.Material);
        }
      });
      scene.environment?.dispose();
      // Free the gradient backdrop CanvasTexture (T1-1) — it's a scene property,
      // not a child, so the traversal above doesn't reach it.
      if (scene.background instanceof THREE.Texture) scene.background.dispose();
      // composer.dispose() only frees its two swap targets + copy pass, so
      // dispose each pass (GTAO's GBuffer targets, SMAA/bloom targets, the
      // OutputPass quad) individually first to avoid leaking on remount.
      composer.passes.forEach((p) =>
        (p as { dispose?: () => void }).dispose?.(),
      );
      composer.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      composerRef.current = null;
      sunRef.current = null;
      hemiRef.current = null;
      fillRef.current = null;
      skyRef.current = null;
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

    // Base work — the concrete/asphalt sub-base the court is built on.
    // Lift the whole court assembly onto a visible pad so the customer
    // can see the foundation they picked; the slab edge shows around and
    // beneath the flooring.
    // P6-03 — vertical profile: the surface build-up (turf pile / slab) + any
    // base elevation add real height to the lift so the court sits on a visible
    // slab/turf lip. Both default to 0 (flat, unchanged) on existing layouts.
    const thicknessFt = layout.plot.surfaceThicknessMm
      ? layout.plot.surfaceThicknessMm / 304.8
      : 0;
    const elevFt = layout.plot.baseElevationFt ?? 0;
    const baseH = (layout.style.baseWork ? 0.6 : 0) + thicknessFt + elevFt;
    group.position.y = baseH;
    if (layout.style.baseWork) {
      const asphalt = layout.style.baseWork === "asphalt";
      const padH = baseH + 0.05;
      const pad = new THREE.Mesh(
        // Chamfered slab (P3-04) so the foundation edge catches a soft
        // highlight instead of reading as a hard CG box.
        new RoundedBoxGeometry(
          layout.plot.lengthFt + 2,
          padH,
          layout.plot.widthFt + 2,
          2,
          0.2,
        ),
        new THREE.MeshStandardMaterial({
          color: asphalt ? 0x35383d : 0xc2c8ce,
          roughness: asphalt ? 0.82 : 0.92,
          metalness: 0,
        }),
      );
      // Top a hair BELOW the court surfaces (which sit at local y≥0) so
      // the flooring and the pad don't z-fight; bottom rests on the earth.
      pad.position.set(0, -padH / 2 - 0.04, 0);
      pad.receiveShadow = true;
      pad.castShadow = true;
      group.add(pad);
    }

    // P6-03 — the surface build-up slab (its side faces are the visible
    // turf/slab "lip") sits directly under the flooring plane (local y ≈ 0).
    if (thicknessFt > 0.01) {
      const surf = layout.style.surface;
      const slabColor =
        layout.style.surfaceColorOverride ??
        (surf && surf !== "plain" ? SURFACE_SOLID_COLOR[surf] : undefined) ??
        (layout.style.groundFinish === "grass" ? "#5c7c3d" : "#c2c8ce");
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(layout.plot.lengthFt, thicknessFt, layout.plot.widthFt),
        new THREE.MeshStandardMaterial({
          color: parseColor(slabColor),
          roughness: 0.9,
          metalness: 0,
        }),
      );
      slab.position.set(0, -thicknessFt / 2 - 0.02, 0);
      slab.receiveShadow = true;
      slab.castShadow = true;
      group.add(slab);
    }
    // Optional raised kerb frame around the plot edge.
    if (layout.plot.curb) {
      const curbMat = new THREE.MeshStandardMaterial({
        color: parseColor(layout.plot.curbColor ?? "#cbd5e1"),
        roughness: 0.85,
        metalness: 0.05,
      });
      const curbH = 0.6;
      const t = 0.6;
      const L = layout.plot.lengthFt;
      const W = layout.plot.widthFt;
      const edges: Array<[number, number, number, number]> = [
        [0, -W / 2, L + t, t],
        [0, W / 2, L + t, t],
        [-L / 2, 0, t, W],
        [L / 2, 0, t, W],
      ];
      edges.forEach(([px, pz, ew, ed]) => {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(ew, curbH, ed), curbMat);
        bar.position.set(px, curbH / 2, pz);
        bar.castShadow = true;
        bar.receiveShadow = true;
        group.add(bar);
      });
    }

    // Centre the plot at world origin. plot-space (0,0) is bottom-left,
    // so we offset every element by -plot.lengthFt/2 horizontally and
    // -plot.widthFt/2 along Z.
    const cx = layout.plot.lengthFt / 2;
    const cy = layout.plot.widthFt / 2;

    // Plot-surface base (turf / acrylic / tile) filling the whole plot — matches
    // the 2D plan so bare-pitch cricket + football run-off show flooring, not
    // grey ground. Added under the court elements.
    const plotSurf = makePlotSurface(layout);
    if (plotSurf) group.add(plotSurf);

    // T1-2 — soft contact shadow "decal" under the whole court so it reads as
    // placed on the ground (the grounding cue the removed GTAO used to hint at,
    // without the black-box artefact). A radial-gradient CanvasTexture (dark
    // centre → transparent edge) on an unlit, depth-write-off transparent plane
    // sized to the plot AABB + margin, sitting just above the earth and below
    // the flooring. Rebuilt with the layout (disposed via the group). Additive:
    // skipped entirely if the texture can't build → today's no-shadow look.
    const contactTex = makeContactShadowTexture();
    if (contactTex) {
      const csMat = new THREE.MeshBasicMaterial({
        map: contactTex,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        // Keep it a clean shadow tint — don't let scene fog wash it out.
        fog: false,
      });
      const cs = new THREE.Mesh(
        new THREE.PlaneGeometry(
          layout.plot.lengthFt * 1.7,
          layout.plot.widthFt * 1.7,
        ),
        csMat,
      );
      cs.rotation.x = -Math.PI / 2;
      // World y ≈ -0.03 (just above the ground plane at -0.05, below the
      // flooring at ≈ -0.02): the group is lifted by baseH, so compensate.
      cs.position.y = -0.03 - baseH;
      cs.renderOrder = -1;
      group.add(cs);
    }

    // Sort by z so larger fields render under overlays (cricket pitch
    // should be on top of the football field).
    const sorted = [...layout.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

    sorted.forEach((el, i) => {
      // Parity: honour the 2D visibility toggle — an element hidden in 2D must
      // NOT reappear in the 3D preview or export.
      if ((el as { visible?: boolean }).visible === false) return;
      const obj = buildElement(el, layout, i * 0.01);
      if (!obj) return;
      // Plot-space (x,y) → world (X, Z). Y is up, so plot Y maps to Z
      // with sign flip so "north" of the plot is -Z in world.
      obj.position.x = el.x - cx;
      obj.position.z = -(el.y - cy);
      obj.rotation.y = -THREE.MathUtils.degToRad(el.rotation);
      group.add(obj);
    });

    // P6-02 — obstacle the boundary curves around (kidney tree/pole).
    if (layout.plot.obstacle) {
      const ob = layout.plot.obstacle;
      const r = Math.max(1, ob.radiusFt ?? 3);
      const ox = ob.x - cx;
      const oz = -(ob.y - cy);
      if (ob.kind === "pole") {
        const poleH = Math.max(8, r * 4);
        const m = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.4, r * 0.5, poleH, 12),
          new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.6, metalness: 0.3 }),
        );
        m.position.set(ox, poleH / 2, oz);
        m.castShadow = true;
        group.add(m);
      } else {
        const trunkH = r * 1.6;
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.18, r * 0.26, trunkH, 8),
          new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }),
        );
        trunk.position.set(ox, trunkH / 2, oz);
        trunk.castShadow = true;
        group.add(trunk);
        const canopy = new THREE.Mesh(
          new THREE.SphereGeometry(r, 16, 12),
          new THREE.MeshStandardMaterial({ color: 0x2f7a3a, roughness: 0.85 }),
        );
        canopy.position.set(ox, trunkH + r * 0.7, oz);
        canopy.castShadow = true;
        canopy.receiveShadow = true;
        group.add(canopy);
      }
    }

    // Dimension sprites — drawn outside the plot footprint so they don't
    // overlap with court markings, but readable from any orbit angle.
    if (layout.style.showDimensions !== false) {
      // Just a clean readable label per edge — NO CAD lines/arrows. White pill,
      // black numbers; depth-tested so it sits at the plot edge without overlap.
      const dimW = Math.max(22, Math.max(layout.plot.lengthFt, layout.plot.widthFt) * 0.075);
      const clr = 6 + dimW * 0.2;
      const lenSprite = makeDimensionSprite(`${layout.plot.lengthFt} ft`, dimW);
      lenSprite.position.set(0, 2, -layout.plot.widthFt / 2 - clr);
      group.add(lenSprite);
      const widthSprite = makeDimensionSprite(`${layout.plot.widthFt} ft`, dimW);
      widthSprite.position.set(-layout.plot.lengthFt / 2 - clr, 2, 0);
      group.add(widthSprite);
    }
    // Fit the sun's shadow frustum to THIS plot (P3-05). The old ±140 ft box
    // clipped shadows off large plots (a 344 ft football pitch) and wasted
    // depth resolution on small ones. Size an orthographic box to the plot
    // half-extent + margin, and push the light back far enough that the whole
    // plot + tall props (goals, fences, floodlight poles) sit inside near/far.
    const sun = sunRef.current;
    if (sun) {
      const half = Math.max(layout.plot.lengthFt, layout.plot.widthFt) / 2;
      const margin = Math.max(20, half * 0.18);
      const ext = half + margin;
      sun.shadow.camera.left = -ext;
      sun.shadow.camera.right = ext;
      sun.shadow.camera.top = ext;
      sun.shadow.camera.bottom = -ext;
      const dist = Math.max(160, ext * 2.2);
      sun.position.copy(sunDirRef.current).multiplyScalar(dist);
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = dist + ext + 80;
      sun.shadow.camera.updateProjectionMatrix();
    }

    // P6-01 — apply the time-of-day lighting profile so evening/night dim the
    // sun + sky + ambient and the floodlight masts (built above with matching
    // beam/emissive levels) read as the light source. Day = today's values.
    const prof = lightingProfile(layout.style.timeOfDay);
    if (sun) {
      sun.intensity = prof.sun;
      sun.color.setHex(prof.sunColor);
    }
    if (hemiRef.current) hemiRef.current.intensity = prof.hemi;
    if (fillRef.current) fillRef.current.intensity = prof.fill;
    scene.environmentIntensity = prof.env;
    // T1-1 — retint the studio gradient backdrop to this time-of-day bg. Only
    // rebuild when the target hex actually changed (the texture caches its
    // source hex in userData) so we don't churn a new CanvasTexture per layout
    // edit. Falls back to a flat THREE.Color if the gradient can't build.
    {
      const prevBg = scene.background;
      const alreadyGradient =
        prevBg instanceof THREE.Texture && prevBg.userData?.bgHex === prof.bg;
      if (!alreadyGradient) {
        const grad = makeBackdropTexture(prof.bg);
        if (grad) {
          scene.background = grad;
          if (prevBg instanceof THREE.Texture) prevBg.dispose();
        } else if (prevBg instanceof THREE.Color) {
          prevBg.setHex(prof.bg);
        } else {
          scene.background = new THREE.Color(prof.bg);
          if (prevBg instanceof THREE.Texture) prevBg.dispose();
        }
      }
    }
    if (scene.fog) {
      const f = scene.fog as THREE.Fog;
      f.color.setHex(prof.fog);
      // Scale the fog to the plot so the COURT is never inside it. A fixed
      // 260-900 range washed large pitches (e.g. 344 ft football) to a pale
      // haze toward the far end; here only the ground/horizon BEYOND the court
      // fades, keeping the playing surface crisp at every plot size.
      const plotMax = Math.max(layout.plot.lengthFt, layout.plot.widthFt);
      f.near = plotMax * 3;
      f.far = plotMax * 10;
    }
    // Hide the physical sky DOME in EVERY view — at eye level it blew the
    // horizon out to white ("remove the sky light" feedback). The soft flat
    // scene background shows instead; the env IBL was already baked from the
    // sky at init, so surface lighting is unaffected.
    if (skyRef.current) {
      skyRef.current.visible = false;
    }

    // Newly rebuilt geometry must be painted at least once even in a static
    // (non-auto-orbit) view, where the loop otherwise stays idle.
    needsRenderRef.current = true;
  }, [layout]);

  // ───────────────────────────────────────────────
  //  React to view-preset changes
  // ───────────────────────────────────────────────
  useEffect(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!controls || !camera) return;
    // Frame every preset from the plot's own extents (P3-05) instead of the
    // old fixed 85/130 ft guesses that cropped large plots and floated tiny
    // ones. `radius` ≈ the plot's larger side; orbit distance/height + the
    // top-down height + zoom clamps all scale off it so a 22 ft pickleball
    // court and a 344 ft football pitch both fill the frame.
    const L = layout.plot.lengthFt;
    const W = layout.plot.widthFt;
    const radius = Math.max(24, Math.max(L, W));
    // T1-4 — the narrower 34° lens magnifies the scene ~1.25× vs the old 42°,
    // so pull every preset back by the same factor to keep the court filling
    // the frame elegantly (framing stays proportional to the plot extents).
    const orbitDist = radius * 1.19;
    const orbitH = radius * 0.78;
    const presets: Record<CourtView, { pos: [number, number, number]; tgt: [number, number, number]; rot: boolean }> = {
      orbit: { pos: [orbitDist, orbitH, orbitDist], tgt: [0, 3, 0], rot: true },
      top: { pos: [0.1, radius * 1.7, 0.1], tgt: [0, 0, 0], rot: false },
      iso: { pos: [orbitDist, orbitH, orbitDist], tgt: [0, 3, 0], rot: false },
      side: { pos: [0, radius * 0.18 + 6, radius * 1.16], tgt: [0, 4, 0], rot: false },
    };
    // Widen the zoom clamps so large plots can actually pull back to frame.
    controls.minDistance = Math.max(10, radius * 0.22);
    controls.maxDistance = Math.max(250, radius * 2.6);
    const v = presets[view];
    camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
    controls.target.set(v.tgt[0], v.tgt[1], v.tgt[2]);
    controls.autoRotate = v.rot;
    controls.autoRotateSpeed = 0.55;
    controls.update();
    // Repaint the new camera framing even when the target view is static.
    needsRenderRef.current = true;
  }, [view, layout.plot.lengthFt, layout.plot.widthFt]);

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
    // Keep the composer's targets + passes in lock-step with the renderer so
    // the post chain doesn't render at a stale resolution (P3-01).
    composerRef.current?.setSize(canvasWidth, canvasHeight);
    // Repaint at the new size/aspect even in a static view.
    needsRenderRef.current = true;
  }, [canvasWidth, canvasHeight]);

  // ───────────────────────────────────────────────
  //  Imperative handle for PNG export
  // ───────────────────────────────────────────────
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      toDataURL(pixelRatio = 1) {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        if (!renderer || !scene || !camera) return null;
        // Render at pixelRatio × the live buffer for a crisp export (the arg
        // used to be ignored, so a 2× request exported at preview resolution on
        // non-retina displays). Aspect is preserved, so no camera update is
        // needed; the live size is restored afterwards.
        // Render through the composer (GTAO/AA/tone-map) so the exported PNG
        // carries the same "product render" as the live preview; fall back to
        // a direct render only if the composer never built.
        const composer = composerRef.current;
        const doRender = () =>
          composer ? composer.render() : renderer.render(scene, camera);
        const size = new THREE.Vector2();
        renderer.getSize(size);
        const ratio = Math.max(1, Math.min(pixelRatio || 1, 4));
        if (ratio !== 1) {
          renderer.setSize(size.x * ratio, size.y * ratio, false);
          composer?.setSize(size.x * ratio, size.y * ratio);
        }
        doRender();
        const wmImg = watermarkImgRef.current;
        const wmOpacity = layoutRef.current.style.watermarkOpacity ?? 0.9;
        const url = !wmImg
          ? renderer.domElement.toDataURL("image/png")
          : compositeWithWatermark(renderer.domElement, wmImg, wmOpacity);
        if (ratio !== 1) {
          renderer.setSize(size.x, size.y, false);
          composer?.setSize(size.x, size.y);
          doRender(); // refresh the live canvas
        }
        return url;
      },
      captureTopDown(pixelRatio = 2) {
        // A straight overhead "drone" still (for the PDF's 3D view). Positions
        // the camera high on Y, looking straight down, frames the whole plot,
        // captures, then restores the live camera.
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        const currentLayout = layoutRef.current;
        if (!renderer || !scene || !camera) return null;
        const prevPos = camera.position.clone();
        const prevUp = camera.up.clone();
        const prevTarget = controls
          ? controls.target.clone()
          : new THREE.Vector3(0, 0, 0);
        const prevAutoRotate = controls?.autoRotate ?? false;
        if (controls) controls.autoRotate = false;
        // Frame the WHOLE plot from straight overhead. A clean up-vector of
        // world -Z (non-degenerate when looking dead down) maps plot length →
        // screen-X and plot width → screen-Y, so we can solve the exact camera
        // height that fits BOTH against the live viewport aspect — instead of
        // the old max(L,W)*1.4 guess that cropped wide plots and wasted margin
        // on square ones.
        const plotL = currentLayout.plot.lengthFt;
        const plotW = currentLayout.plot.widthFt;
        const margin = 1.06; // small breathing room around the plot edges
        const vFov = THREE.MathUtils.degToRad(camera.fov);
        const halfTan = Math.tan(vFov / 2);
        const aspect = camera.aspect || 1;
        // Height so plot width fills the vertical extent, and so plot length
        // fills the horizontal extent (= vertical extent × aspect); take the
        // larger so nothing is cropped.
        const hForWidth = plotW / (2 * halfTan);
        const hForLength = plotL / (2 * halfTan * aspect);
        const height = Math.max(hForWidth, hForLength) * margin;
        camera.up.set(0, 0, -1);
        camera.position.set(0, height, 0);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        const composer = composerRef.current;
        const doRender = () =>
          composer ? composer.render() : renderer.render(scene, camera);
        const size = new THREE.Vector2();
        renderer.getSize(size);
        const ratio = Math.max(1, Math.min(pixelRatio || 1, 4));
        if (ratio !== 1) {
          renderer.setSize(size.x * ratio, size.y * ratio, false);
          composer?.setSize(size.x * ratio, size.y * ratio);
        }
        doRender();
        const wmImg = watermarkImgRef.current;
        const wmOpacity = layoutRef.current.style.watermarkOpacity ?? 0.9;
        const url = !wmImg
          ? renderer.domElement.toDataURL("image/png")
          : compositeWithWatermark(renderer.domElement, wmImg, wmOpacity);
        // Restore live camera + size (up-vector first so controls.update()
        // rebuilds the orientation from the correct basis).
        if (ratio !== 1) {
          renderer.setSize(size.x, size.y, false);
          composer?.setSize(size.x, size.y);
        }
        camera.up.copy(prevUp);
        camera.position.copy(prevPos);
        if (controls) {
          controls.target.copy(prevTarget);
          controls.autoRotate = prevAutoRotate;
          controls.update();
        } else {
          camera.lookAt(prevTarget);
        }
        camera.updateProjectionMatrix();
        doRender();
        return url;
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
        // Cap the recorded resolution: scale to fit a MAX_DIM box (keeps the
        // MP4 small + WhatsApp-friendly) and force EVEN dimensions. Combined
        // with the higher AVC level below, this fixes the "coded area exceeds
        // the maximum coded area supported by the AVC level" encode error that
        // hit on larger / high-DPI canvases.
        const MAX_DIM = 1280;
        const srcScale = Math.min(
          1,
          MAX_DIM / Math.max(canvas.width, canvas.height),
        );
        let w = Math.round(canvas.width * srcScale);
        let h = Math.round(canvas.height * srcScale);
        w -= w % 2;
        h -= h % 2;

        const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
        const muxer = new Muxer({
          target: new ArrayBufferTarget(),
          video: { codec: "avc", width: w, height: h },
          fastStart: "in-memory",
        });

        // Every frame is drawn into a 2D canvas at the (capped) target size —
        // this scales the WebGL canvas down to the recording resolution and
        // bakes in the watermark. Reading from this fixed-size canvas is what
        // keeps the encoder within its AVC level regardless of the live canvas.
        const wmImg = watermarkImgRef.current;
        const wmOpacity = layoutRef.current.style.watermarkOpacity ?? 0.9;
        const frameCanvas = document.createElement("canvas");
        frameCanvas.width = w;
        frameCanvas.height = h;
        const frameCtx = frameCanvas.getContext("2d")!;

        let encoderError: unknown = null;
        const encoder = new window.VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
          error: (e) => {
            encoderError = e;
          },
        });
        encoder.configure({
          codec: "avc1.42E028", // H.264 Baseline profile, level 4.0 — ample coded-area headroom
          width: w,
          height: h,
          bitrate: 3_000_000,
          framerate: fps,
        });

        // Orbit at a comfortable radius — derived from plot extents so
        // small plots get a closer pass and large plots stay framed.
        const plotL = currentLayout.plot.lengthFt;
        const plotW = currentLayout.plot.widthFt;
        // 1.38 (was 1.1) compensates for the narrower T1-4 34° lens so the
        // recorded orbit / spin frames keep the same framing as before.
        const radius = Math.max(plotL, plotW) * 1.38;
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
            // Render each orbit frame through the composer so the recorded MP4
            // gets the same GTAO/AA/tone-map as the live preview.
            if (composerRef.current) composerRef.current.render();
            else renderer.render(scene, camera);

            // When a watermark is set, draw the WebGL canvas → 2D composite
            // and overlay the logo. The encoder then takes the composite
            // canvas as its source.
            // Scale the WebGL canvas into the fixed-size frame canvas, then
            // overlay the watermark if one is set.
            frameCtx.drawImage(canvas, 0, 0, w, h);
            if (wmImg) drawWatermarkOn(frameCtx, wmImg, w, h, wmOpacity);
            const frame = new window.VideoFrame(frameCanvas, {
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
          // Resume the shared on-demand loop rather than starting a second,
          // always-render loop (which would peg the GPU again after export).
          needsRenderRef.current = true;
          animateRef.current?.();
        }
      },
      async captureSpinFrames(options) {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        const currentLayout = layoutRef.current;
        if (!renderer || !scene || !camera) return null;
        // P2-03: raise the spin-file quality — smoother rotation (36 frames =
        // 10°/step), sharper JPEG, and a bigger frame so it reads on a phone.
        // Callers (e.g. the PDF's 6-angle turntable) can still override.
        const frames = Math.max(8, Math.min(48, options?.frames ?? 36));
        const quality = options?.quality ?? 0.9;
        const maxWidth = options?.maxWidth ?? 1440;

        // Take over the camera from the live loop + auto-orbit while we
        // step through the spin. Restored in finally.
        const prevAutoRotate = controls?.autoRotate ?? false;
        if (controls) {
          controls.autoRotate = false;
          controls.enabled = false;
        }
        cancelAnimationFrame(animationIdRef.current);

        const canvas = renderer.domElement;
        // Downscale into a 2D canvas to cap file size + bake the watermark.
        const scale = canvas.width > maxWidth ? maxWidth / canvas.width : 1;
        const outW = Math.max(2, Math.round(canvas.width * scale));
        const outH = Math.max(2, Math.round(canvas.height * scale));
        const out = document.createElement("canvas");
        out.width = outW;
        out.height = outH;
        const octx = out.getContext("2d");
        const wmImg = watermarkImgRef.current;
        const wmOpacity = layoutRef.current.style.watermarkOpacity ?? 0.9;

        // Horizontal orbit at fixed pitch — same radius derivation as the
        // MP4 recorder, but y stays constant so it's a pure yaw spin.
        const plotL = currentLayout.plot.lengthFt;
        const plotW = currentLayout.plot.widthFt;
        // 1.38 (was 1.1) compensates for the narrower T1-4 34° lens so the
        // recorded orbit / spin frames keep the same framing as before.
        const radius = Math.max(plotL, plotW) * 1.38;

        const urls: string[] = [];
        try {
          if (!octx) return null;
          for (let i = 0; i < frames; i++) {
            const angle = (i / frames) * Math.PI * 2;
            camera.position.x = Math.sin(angle) * radius;
            camera.position.z = Math.cos(angle) * radius;
            camera.position.y = radius * 0.55;
            camera.lookAt(0, 0, 0);
            // Composer render so spin-file frames match the live preview.
            if (composerRef.current) composerRef.current.render();
            else renderer.render(scene, camera);
            octx.drawImage(canvas, 0, 0, outW, outH);
            if (wmImg) drawWatermarkOn(octx, wmImg, outW, outH, wmOpacity);
            urls.push(out.toDataURL("image/jpeg", quality));
            options?.onProgress?.((i + 1) / frames);
            // Yield occasionally so the UI thread stays responsive.
            if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
          }
          return urls;
        } finally {
          if (controls) {
            controls.enabled = true;
            controls.autoRotate = prevAutoRotate;
          }
          // Resume the shared on-demand loop rather than a second always-on one.
          needsRenderRef.current = true;
          animateRef.current?.();
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
    case "floodlight":
      return makeFloodlight(el, layout);
    case "seating":
      return makeSeating(el);
    case "scoreboard":
      return makeScoreboard(el);
    case "sight-screen":
      return makeSightScreen(el);
    case "corner-flag":
      return makeCornerFlag(el);
    case "gate":
      return makeGate(el);
    case "center-logo":
      return makeCenterLogo(el, yOffset);
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
    // Bias toward camera so the tint reliably sits on the court surface
    // rather than z-fighting it at grazing angles (P3-06).
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -3,
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
  // T2-1/T2-2 — a football field is ALWAYS grass, so it always takes the turf
  // mow-sheen path (finish "turf"). Route the plot surface ONLY when it is a
  // turf finish so the registry's turf roughness/normalScale/mow-direction
  // apply; a non-turf plot (acrylic/tile/plain) is left undefined so the grass
  // never inherits acrylic gloss — today's matte-grass look is the fallback.
  const plotSurface = layout.style.surface;
  const mat = surfaceMaterial(tex, {
    roughness: 0.92,
    finish: "turf",
    surface: plotSurface && isTurfSurface(plotSurface) ? plotSurface : undefined,
    widthFt: el.width,
    heightFt: el.height,
  });
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
  const mat = surfaceMaterial(tex, {
    roughness: 0.9,
    finish: "hard",
    widthFt: el.pitchLengthFt,
    heightFt: el.pitchWidthFt,
    // Sits on top of the football grass — bias it forward in depth so it wins
    // cleanly at grazing angles instead of relying only on the tiny y-gap.
    polygonOffsetUnits: -2,
  });
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
  // T2-1 — route the plot's real surface so the hard-court reads as its actual
  // material (acrylic wet-gloss / PPE tile / turf / PVC) instead of the old
  // hardcoded flat. surfaceToFinish picks the micro-relief; the registry drives
  // roughness/clearcoat. Falls back to today's 0.55 flat when surface is plain.
  const surface = layout.style.surface;
  const mat = surfaceMaterial(tex, {
    roughness: 0.55,
    finish: surfaceToFinish(surface),
    surface,
    widthFt: el.width,
    heightFt: el.height,
  });
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
  // T2-1 — route the plot's real surface (acrylic / tile / turf / PVC) so the
  // pickleball court reads as its actual material; today's 0.55 flat is the
  // fallback when the plot surface is plain.
  const surface = layout.style.surface;
  const mat = surfaceMaterial(tex, {
    roughness: 0.55,
    finish: surfaceToFinish(surface),
    surface,
    widthFt: el.width,
    heightFt: el.height,
  });
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
  const tex = genericCourtTexture(el, layout);
  // T2-1 — generic court draws tennis / badminton / volleyball; route the plot's
  // real surface so all three read as their actual material (acrylic wet-gloss /
  // tile / turf / PVC). Today's 0.6 flat is the fallback for a plain plot.
  const surface = layout.style.surface;
  const mat = surfaceMaterial(tex, {
    roughness: 0.6,
    finish: surfaceToFinish(surface),
    surface,
    widthFt: el.width,
    heightFt: el.height,
  });
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
  // T2-4 — brushed-metal net uprights (volleyball / tennis / badminton).
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    metalness: 0.88,
    roughness: 0.38,
    envMapIntensity: 1.1,
  });
  const postGeo = new THREE.CylinderGeometry(0.15, 0.15, el.heightFt, 16);
  const left = new THREE.Mesh(postGeo, postMat);
  left.position.set(-el.widthFt / 2, el.heightFt / 2, 0);
  left.castShadow = true;
  g.add(left);
  const right = new THREE.Mesh(postGeo.clone(), postMat);
  right.position.set(el.widthFt / 2, el.heightFt / 2, 0);
  right.castShadow = true;
  g.add(right);
  // Lit alpha-cutout net membrane (P3-03) — real holes, catches sun/sky.
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(el.widthFt, el.heightFt),
    netMaterial(0xf0f0f0, el.widthFt, el.heightFt, "square"),
  );
  net.position.set(0, el.heightFt / 2, 0);
  net.receiveShadow = true;
  g.add(net);
  // White tape band along the top edge (volleyball / tennis / badminton).
  const tapeH = Math.max(0.25, el.heightFt * 0.06);
  const tape = new THREE.Mesh(
    new THREE.PlaneGeometry(el.widthFt, tapeH),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.7,
      side: THREE.DoubleSide,
    }),
  );
  tape.position.set(0, el.heightFt - tapeH / 2, 0.01);
  g.add(tape);
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
  tex.anisotropy = MAX_ANISOTROPY;
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
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -3,
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
  const mat = new THREE.MeshBasicMaterial({
    color: parseColor(el.color ?? "#0f172a"),
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
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
  // Lit chain-link mesh (P3-03/P3-04) — alpha-cutout diamonds so the fence
  // reads as see-through galvanised mesh that light + sky pass through,
  // instead of a flat translucent sheet.
  const matMesh = netMaterial(
    color,
    Math.max(el.width, el.height),
    el.heightFt,
    "diamond",
  );
  // Posts at the corners
  const postMat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.55,
    roughness: 0.5,
    envMapIntensity: 0.7,
  });
  const postGeo = new THREE.CylinderGeometry(0.18, 0.18, el.heightFt, 16);
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
        mesh.receiveShadow = true;
        group.add(mesh);
      });
    } else {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spanFt, el.heightFt), matMesh);
      mesh.position.copy(placeFn(0, spanFt));
      mesh.rotation.y = edge === "east" || edge === "west" ? Math.PI / 2 : 0;
      mesh.receiveShadow = true;
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
  // MeshStandard so the dugout sits in the same PBR lighting as the rest of
  // the scene (P3-04); RoundedBoxGeometry chamfers every panel so edges catch
  // a soft highlight instead of reading as hard CG blocks.
  const wallMat = new THREE.MeshStandardMaterial({
    color: parseColor(el.benchColor ?? "#cbd5e1"),
    roughness: 0.8,
    metalness: 0.05,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: parseColor(el.roofColor ?? "#475569"),
    roughness: 0.6,
    metalness: 0.1,
  });
  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(el.width, el.height), wallMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.03;
  floor.receiveShadow = true;
  group.add(floor);
  // Back wall
  const backH = baseH;
  const back = new THREE.Mesh(
    new RoundedBoxGeometry(el.width, backH, 0.4, 2, 0.08),
    wallMat,
  );
  back.position.set(0, backH / 2, -el.height / 2);
  back.castShadow = true;
  back.receiveShadow = true;
  group.add(back);
  // Side walls (shorter so the open side is taller)
  [-1, 1].forEach((sideDir) => {
    const side = new THREE.Mesh(
      new RoundedBoxGeometry(0.4, baseH * 0.85, el.height, 2, 0.08),
      wallMat
    );
    side.position.set((sideDir * el.width) / 2, (baseH * 0.85) / 2, 0);
    side.castShadow = true;
    side.receiveShadow = true;
    group.add(side);
  });
  // Bench (a chunky low platform along the back wall)
  const benchH = 1.2;
  const benchDepth = Math.min(2, el.height * 0.45);
  const benchRadius = Math.min(0.1, benchDepth / 2 - 0.01, benchH / 2 - 0.01);
  const bench = new THREE.Mesh(
    new RoundedBoxGeometry(el.width - 0.6, benchH, benchDepth, 2, Math.max(0.02, benchRadius)),
    new THREE.MeshStandardMaterial({
      color: parseColor("#94a3b8"),
      roughness: 0.7,
      metalness: 0.05,
    })
  );
  bench.position.set(0, benchH / 2 + 0.05, -el.height / 2 + benchDepth / 2 + 0.3);
  bench.castShadow = true;
  group.add(bench);
  // Roof — tilts down towards the open side so rain runs off
  const roof = new THREE.Mesh(
    new RoundedBoxGeometry(el.width + 0.8, 0.3, el.height + 0.8, 2, 0.06),
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
  // T2-4 — brushed-metal pole + rim so they read as steel against the low
  // ambient (raised envMapIntensity + higher metalness / tighter roughness).
  const poleMat = new THREE.MeshStandardMaterial({
    color: parseColor(el.color ?? "#0f172a"),
    metalness: 0.9,
    roughness: 0.35,
    envMapIntensity: 1.2,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: parseColor(el.rimColor ?? "#ef4444"),
    metalness: 0.85,
    roughness: 0.35,
    envMapIntensity: 1.2,
  });
  // Pole — vertical cylinder behind the backboard
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.3, el.poleHeightFt, 16),
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
    new RoundedBoxGeometry(bbW, bbH, 0.1, 2, 0.04),
    // T2-4 — glassy tempered backboard: lower roughness + raised envMapIntensity
    // so it catches a clean sky/sun reflection like a real board.
    new THREE.MeshStandardMaterial({
      color: 0xfafafa,
      roughness: 0.15,
      metalness: 0.0,
      envMapIntensity: 1.0,
    })
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
    new THREE.TorusGeometry(rimR, 0.08, 16, 32),
    rimMat
  );
  rim.position.set(0, el.poleHeightFt - 1.2, armLen + rimR);
  rim.rotation.x = Math.PI / 2;
  rim.castShadow = true;
  group.add(rim);
  // Net — lit alpha-cutout weave (P3-03) instead of a flat translucent cone.
  const net = new THREE.Mesh(
    new THREE.CylinderGeometry(rimR * 0.8, rimR * 0.3, 1, 16, 1, true),
    netMaterial(0xffffff, rimR * 2 * Math.PI, 1, "square"),
  );
  net.position.set(0, el.poleHeightFt - 1.7, armLen + rimR);
  group.add(net);
  return group;
}

// ── P6 facility element builders ─────────────────────────────────────

// Art-directed lighting levels per time of day. Applied to the scene lights in
// the layout-rebuild effect; floodlight beam + lamp emissive scale off the same
// profile so evening/night actually read as floodlit.
type LightProfile = {
  sun: number;
  sunColor: number;
  hemi: number;
  fill: number;
  env: number;
  bg: number;
  fog: number;
  floodBeam: number; // spotlight intensity
  floodEmissive: number; // lamp emissive intensity
};
function lightingProfile(t: CourtLayout["style"]["timeOfDay"]): LightProfile {
  if (t === "night") {
    return {
      sun: 0.12,
      sunColor: 0x9fb4d6,
      hemi: 0.12,
      fill: 0.08,
      env: 0.16,
      bg: 0x0c1424,
      fog: 0x101a2e,
      floodBeam: 6,
      floodEmissive: 2.6,
    };
  }
  if (t === "evening") {
    return {
      sun: 0.8,
      sunColor: 0xffb27a,
      hemi: 0.22,
      fill: 0.25,
      env: 0.45,
      bg: 0x27324c,
      fog: 0x38455f,
      floodBeam: 3.4,
      floodEmissive: 1.6,
    };
  }
  return {
    sun: 2.6,
    sunColor: 0xfff2d6,
    hemi: 0.22,
    fill: 0.35,
    // Sky-based ambient (IBL) kept very LOW per feedback — the bright sky probe
    // washed the pitch out even after earlier cuts ("remove the sky light").
    // Sun + hemisphere carry the lighting now; only a whisper of env stays so
    // metal posts/rims aren't pure black.
    env: 0.1,
    bg: 0x8fb8de,
    fog: 0xcbd9e6,
    floodBeam: 0.55,
    floodEmissive: 0.35,
  };
}

// T1-1 — studio gradient backdrop. Builds a small vertical-gradient
// CanvasTexture from the time-of-day bg colour: a lifted, slightly desaturated
// top (soft "sky"), the base colour through the middle, and a deeper, faintly
// warmer bottom — so the scene reads like a photographer's sweep instead of a
// flat fill. Caches its source hex in userData so the layout effect can skip
// rebuilding when the colour hasn't changed. Returns null on any failure so the
// caller degrades to today's flat THREE.Color background.
function makeBackdropTexture(bgHex: number): THREE.Texture | null {
  try {
    if (typeof document === "undefined") return null;
    const w = 16;
    const h = 256;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const base = new THREE.Color(bgHex);
    // Wider lightness sweep so it reads as a real studio backdrop, not a flat panel.
    const top = base.clone().offsetHSL(0, -0.08, 0.2);
    const mid = base.clone().offsetHSL(0, 0.0, 0.0);
    const bottom = base.clone().offsetHSL(0, 0.06, -0.3);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `#${top.getHexString()}`);
    grad.addColorStop(0.55, `#${mid.getHexString()}`);
    grad.addColorStop(1, `#${bottom.getHexString()}`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.bgHex = bgHex;
    return tex;
  } catch {
    return null;
  }
}

// T1-2 — radial-gradient alpha "decal" for the soft contact shadow under the
// court (dark centre → transparent edge). Unlit; stretched to the plot aspect
// by the caller. Returns null on failure so the caller skips the shadow (today's
// look) rather than erroring.
function makeContactShadowTexture(): THREE.CanvasTexture | null {
  try {
    if (typeof document === "undefined") return null;
    const size = 256;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const mid = size / 2;
    const g = ctx.createRadialGradient(
      mid,
      mid,
      size * 0.06,
      mid,
      mid,
      size * 0.5,
    );
    // Stay dark THROUGH the court footprint (inner ~0.6) so a soft dark halo
    // shows just outside the court edge (the centre is hidden under the
    // flooring); fade to nothing by the plane edge so there's no hard rim.
    g.addColorStop(0, "rgba(0,0,0,0.5)");
    g.addColorStop(0.6, "rgba(0,0,0,0.45)");
    g.addColorStop(0.85, "rgba(0,0,0,0.15)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  } catch {
    return null;
  }
}

// T1-3 — final colour-grade + vignette shader (fed to a ShaderPass after the
// OutputPass, so it grades the display-space image). Subtle S-curve contrast,
// a ~+6% saturation lift, and a soft radial vignette. Values are intentionally
// gentle and are the ones to dial in on 3100.
function gradeVignetteShader() {
  return {
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      uContrast: { value: 0.12 },
      uSaturation: { value: 1.06 },
      uVignette: { value: 0.22 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uContrast;
      uniform float uSaturation;
      uniform float uVignette;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        vec3 c = texel.rgb;
        // Subtle S-curve contrast: blend toward a smoothstep response so mids
        // gain a little punch without crushing shadows/highlights.
        vec3 s = smoothstep(0.0, 1.0, c);
        c = mix(c, s, uContrast);
        // Gentle saturation lift around perceptual luma.
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(luma), c, uSaturation);
        // Soft radial vignette to draw the eye to the court.
        float d = distance(vUv, vec2(0.5));
        float vig = 1.0 - uVignette * smoothstep(0.35, 0.85, d);
        c *= vig;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), texel.a);
      }
    `,
  };
}

// Colour-temperature (Kelvin) → RGB (Tanner Helland approximation).
function kelvinToThreeColor(kelvin: number): THREE.Color {
  const temp = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
  }
  if (temp >= 66) b = 255;
  else if (temp <= 19) b = 0;
  else b = 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  const cl = (v: number) => Math.max(0, Math.min(255, v)) / 255;
  return new THREE.Color(cl(r), cl(g), cl(b));
}

function makeFloodlight(el: FloodlightElement, layout: CourtLayout): THREE.Object3D {
  const group = new THREE.Group();
  const prof = lightingProfile(layout.style.timeOfDay);
  const poleH = Math.max(6, el.poleHeightFt);
  const lampColor = kelvinToThreeColor(el.colorTempK ?? 5000);
  const heads = Math.max(1, Math.min(12, Math.round(el.heads ?? 4)));

  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x3a4048,
    metalness: 0.6,
    roughness: 0.45,
    envMapIntensity: 0.7,
  });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, poleH, 16), poleMat);
  pole.position.y = poleH / 2;
  pole.castShadow = true;
  group.add(pole);

  const barW = Math.max(4, heads * 1.6);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(barW, 0.4, 0.6), poleMat);
  bar.position.set(0, poleH + 0.2, 0);
  group.add(bar);

  // Lamp heads — emissive so they glow at dusk/night; tilted down toward the
  // field (local -Z = forward, aimed at the plot by the element rotation).
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    emissive: lampColor,
    emissiveIntensity: prof.floodEmissive,
    metalness: 0.3,
    roughness: 0.4,
  });
  for (let i = 0; i < heads; i++) {
    const lx = -barW / 2 + (i + 0.5) * (barW / heads);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry((barW / heads) * 0.75, 0.85, 0.5),
      lampMat,
    );
    head.position.set(lx, poleH + 0.1, -0.4);
    head.rotation.x = 0.5;
    group.add(head);
  }

  // Downward SpotLight pooling light on the surface, aimed forward (local -Z).
  const reach = Math.max(
    10,
    el.aimReachFt ?? Math.max(layout.plot.lengthFt, layout.plot.widthFt) * 0.45,
  );
  const spot = new THREE.SpotLight(lampColor.getHex(), prof.floodBeam);
  spot.position.set(0, poleH, 0);
  spot.angle = Math.PI / 4.2;
  spot.penumbra = 0.5;
  spot.decay = 0; // art-directed flat pool (predictable across time-of-day)
  spot.distance = poleH * 2 + reach * 1.5;
  spot.castShadow = false; // sun supplies the main shadow; keep perf + light count sane
  const target = new THREE.Object3D();
  target.position.set(0, 0, -reach);
  group.add(target);
  spot.target = target;
  group.add(spot);
  return group;
}

function makeSeating(el: SeatingElement): THREE.Object3D {
  const group = new THREE.Group();
  const rows = Math.max(2, Math.min(8, Math.round(el.rows ?? 4)));
  const color = parseColor(el.color ?? "#3b82f6");
  const stepDepth = el.depth / rows;
  const stepH = 1.4;
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x8b93a1,
    roughness: 0.8,
    metalness: 0.1,
  });
  const seatMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
  for (let i = 0; i < rows; i++) {
    // Row 0 = back (tallest, local +Z); last row = front (lowest, toward field).
    const level = rows - i;
    const y = level * stepH;
    const z = el.depth / 2 - i * stepDepth - stepDepth / 2;
    const riser = new THREE.Mesh(new THREE.BoxGeometry(el.width, y, stepDepth), frameMat);
    riser.position.set(0, y / 2, z);
    riser.castShadow = true;
    riser.receiveShadow = true;
    group.add(riser);
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(el.width, 0.25, stepDepth * 0.85),
      seatMat,
    );
    seat.position.set(0, y + 0.14, z);
    seat.castShadow = true;
    group.add(seat);
  }
  return group;
}

function makeScoreboard(el: ScoreboardElement): THREE.Object3D {
  const group = new THREE.Group();
  const w = el.widthFt;
  const panelH = Math.max(3, w * 0.55);
  const top = Math.max(el.heightFt, panelH + 3);
  const frameMat = new THREE.MeshStandardMaterial({
    color: parseColor(el.color ?? "#0f172a"),
    roughness: 0.6,
    metalness: 0.2,
  });
  [-1, 1].forEach((d) => {
    const postH = top - panelH / 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, postH, 12), frameMat);
    post.position.set(d * w * 0.42, postH / 2, 0);
    post.castShadow = true;
    group.add(post);
  });
  const panel = new THREE.Mesh(
    new RoundedBoxGeometry(w, panelH, 0.4, 2, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0x111827,
      emissive: 0x0e7490,
      emissiveIntensity: 0.35,
      roughness: 0.4,
    }),
  );
  panel.position.set(0, top - panelH / 2, 0);
  panel.castShadow = true;
  group.add(panel);
  const frame = new THREE.Mesh(
    new RoundedBoxGeometry(w + 0.6, panelH + 0.6, 0.3, 2, 0.06),
    frameMat,
  );
  frame.position.set(0, top - panelH / 2, -0.1);
  group.add(frame);
  return group;
}

function makeSightScreen(el: SightScreenElement): THREE.Object3D {
  const group = new THREE.Group();
  const w = el.widthFt;
  const h = el.heightFt;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.3),
    new THREE.MeshStandardMaterial({
      color: parseColor(el.color ?? "#f1f5f9"),
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  board.position.set(0, h / 2 + 0.5, 0);
  board.castShadow = true;
  board.receiveShadow = true;
  group.add(board);
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.6,
    metalness: 0.3,
  });
  [-1, 1].forEach((d) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, h * 0.6, 10), legMat);
    leg.position.set(d * w * 0.4, h * 0.3, 0.3);
    leg.rotation.x = 0.12;
    leg.castShadow = true;
    group.add(leg);
  });
  return group;
}

function makeCornerFlag(el: CornerFlagElement): THREE.Object3D {
  const group = new THREE.Group();
  const h = el.heightFt ?? 5;
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.5,
    metalness: 0.1,
  });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, h, 8), poleMat);
  pole.position.y = h / 2;
  pole.castShadow = true;
  group.add(pole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(h * 0.5, h * 0.3),
    new THREE.MeshStandardMaterial({
      color: parseColor(el.color ?? "#ef4444"),
      roughness: 0.7,
      side: THREE.DoubleSide,
    }),
  );
  flag.position.set(h * 0.25, h - h * 0.2, 0);
  flag.castShadow = true;
  group.add(flag);
  return group;
}

function makeGate(el: GateElement): THREE.Object3D {
  const group = new THREE.Group();
  const w = el.widthFt;
  const h = el.heightFt;
  const color = parseColor(el.color ?? "#94a3b8");
  const postMat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.5,
    roughness: 0.5,
  });
  [-1, 1].forEach((d) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, h, 12), postMat);
    post.position.set((d * w) / 2, h / 2, 0);
    post.castShadow = true;
    group.add(post);
  });
  // Swing leaf — chain-link mesh panel hinged at the left post, opened ~40°.
  const hinge = new THREE.Group();
  hinge.position.set(-w / 2, h / 2, 0);
  const leaf = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.9, h * 0.85),
    netMaterial(color, w, h, "diamond"),
  );
  leaf.position.set((w * 0.9) / 2, 0, 0);
  leaf.receiveShadow = true;
  hinge.add(leaf);
  hinge.rotation.y = -Math.PI / 4.5;
  group.add(hinge);
  return group;
}

function centerLogoTexture(el: CenterLogoElement): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const ring = el.color ?? "#ffffff";
  const drawBase = () => {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = ring;
    ctx.lineWidth = size * 0.03;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
    ctx.stroke();
  };
  drawBase();
  // Text fallback (drawn immediately; upgraded to the bitmap when it loads).
  ctx.fillStyle = ring;
  ctx.font = `700 ${Math.round(size * 0.15)}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText((el.text ?? "FITOVERSE").slice(0, 12), size / 2, size / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = MAX_ANISOTROPY;
  if (el.imageUrl) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      drawBase();
      const s = size * 0.72;
      ctx.drawImage(img, (size - s) / 2, (size - s) / 2, s, s);
      tex.needsUpdate = true;
    };
    img.src = el.imageUrl;
  }
  return tex;
}

function makeCenterLogo(el: CenterLogoElement, yOffset: number): THREE.Object3D {
  // Flat decal disc on the playing surface — biased toward camera so it sits
  // cleanly on the surface without z-fighting.
  const tex = centerLogoTexture(el);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    roughness: 0.6,
    metalness: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -3,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(el.diameterFt / 2, 48), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = yOffset + 0.06;
  mesh.receiveShadow = true;
  return mesh;
}

function buildPostsAndCrossbar(widthFt: number, heightFt: number, depthFt: number): THREE.Group {
  const g = new THREE.Group();
  // T2-4 — brushed galvanised-steel goal: near-full metalness with a brushed
  // roughness so the sun leaves a crisp specular streak down each post, and a
  // raised envMapIntensity so the frame reads as real metal against the low
  // ambient (the sky probe is dialled way down).
  const mat = new THREE.MeshStandardMaterial({
    color: 0xf4f6f8,
    metalness: 0.9,
    roughness: 0.38,
    envMapIntensity: 1.2,
  });
  const postGeo = new THREE.CylinderGeometry(0.32, 0.32, heightFt, 20);
  const left = new THREE.Mesh(postGeo, mat);
  left.position.set(0, heightFt / 2, -widthFt / 2);
  left.castShadow = true;
  g.add(left);
  const right = new THREE.Mesh(postGeo.clone(), mat);
  right.position.set(0, heightFt / 2, widthFt / 2);
  right.castShadow = true;
  g.add(right);
  const cross = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, widthFt, 20),
    mat
  );
  cross.rotation.x = Math.PI / 2;
  cross.position.set(0, heightFt, 0);
  cross.castShadow = true;
  g.add(cross);
  // Rounded joints where each post meets the crossbar (P3-04) so the corners
  // read as a welded frame instead of two cylinders clipping through.
  const jointGeo = new THREE.SphereGeometry(0.34, 16, 12);
  [-1, 1].forEach((s) => {
    const joint = new THREE.Mesh(jointGeo, mat);
    joint.position.set(0, heightFt, (s * widthFt) / 2);
    joint.castShadow = true;
    g.add(joint);
  });
  // Back posts + lit alpha-cutout net for that classic goal silhouette (P3-03).
  const backPostGeo = new THREE.CylinderGeometry(0.22, 0.22, heightFt - 1, 16);
  const bl = new THREE.Mesh(backPostGeo, mat);
  bl.position.set(-depthFt, (heightFt - 1) / 2, -widthFt / 2);
  bl.castShadow = true;
  g.add(bl);
  const br = new THREE.Mesh(backPostGeo.clone(), mat);
  br.position.set(-depthFt, (heightFt - 1) / 2, widthFt / 2);
  br.castShadow = true;
  g.add(br);
  const netMat = netMaterial(0xededed, widthFt, heightFt - 1, "square");
  const back = new THREE.Mesh(new THREE.PlaneGeometry(widthFt, heightFt - 1), netMat);
  back.position.set(-depthFt, (heightFt - 1) / 2, 0);
  back.rotation.y = Math.PI / 2;
  back.receiveShadow = true;
  g.add(back);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(widthFt, depthFt), netMat);
  top.position.set(-depthFt / 2, heightFt - 0.15, 0);
  top.rotation.x = Math.PI / 2;
  top.receiveShadow = true;
  g.add(top);
  const sideGeo = new THREE.PlaneGeometry(depthFt, heightFt - 0.6);
  const sl = new THREE.Mesh(sideGeo, netMat);
  sl.position.set(-depthFt / 2, (heightFt - 0.6) / 2, -widthFt / 2);
  sl.receiveShadow = true;
  g.add(sl);
  const sr = new THREE.Mesh(sideGeo.clone(), netMat);
  sr.position.set(-depthFt / 2, (heightFt - 0.6) / 2, widthFt / 2);
  sr.receiveShadow = true;
  g.add(sr);
  return g;
}

// Micro-surface family for a flooring plane. Phase 4's FINISH_MATERIAL
// registry will own these; for now they are chosen per sport at the call
// sites. "turf" = directional grass pile, "hard" = acrylic/PVC/matting
// grain, "flat" = smooth acrylic/tile with no normal relief.
type SurfaceFinish = "turf" | "hard" | "flat";

type SurfaceMaterialOpts = {
  roughness: number;
  // Real-world footprint of the plane (ft) — drives the physical tiling of the
  // normal map so it repeats at a real scale independent of the albedo canvas
  // (which is stretched 1:1 across the plane).
  widthFt?: number;
  heightFt?: number;
  finish?: SurfaceFinish;
  // T2-1 — the plot's REAL finish (schema SurfaceFinish). When present (and not
  // "plain"), surfaceMaterial reads roughness/metalness/clearcoat/normalScale/
  // stripeDirectionDeg from FINISH_MATERIAL[surface] — ONE source of truth with
  // the 2D layer — so acrylic reads wet-glossy, turf gets a mow sheen, etc.
  // Absent/"plain" → the per-sport `roughness`/`finish` above stay in charge
  // (today's look, the additive fallback).
  surface?: PlotSurfaceFinish;
  // Depth-bias so co-planar overlays (e.g. a cricket strip lying on the
  // football grass) win the depth test without a large physical y-gap (P3-06).
  polygonOffsetUnits?: number;
};

// Map a real plot finish (schema) onto the local micro-relief family used for
// the tiling normal map: turf → directional pile, PPE tile / PVC → grain,
// acrylic / plain → smooth (flat). Keeps the normal-map selection in sync when
// a court routes its plot surface into surfaceMaterial (T2-1).
function surfaceToFinish(surface?: PlotSurfaceFinish): SurfaceFinish {
  if (!surface) return "flat";
  if (isTurfSurface(surface)) return "turf";
  if (isTiledSurface(surface) || isPvcSurface(surface)) return "hard";
  return "flat"; // acrylic (smooth, glossed via clearcoat) + plain earth
}

// Procedural tiling NORMAL map for court/ground surfaces (P3-02). Builds a
// small height field (directional pile for turf, isotropic speckle for hard
// courts / earth), then Sobel-derives per-texel normals. Wrapped
// RepeatWrapping + tiled to a real-world scale by the caller so grazing sun
// rakes across the micro-relief instead of reading as flat plastic. The data
// is linear (NoColorSpace), never sRGB. Phase 4's material registry will
// parameterize kind / strength / tiling from the finish spec.
function makeSurfaceNormalTexture(
  kind: "turf" | "grain",
  repeatX: number,
  repeatY: number,
): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#808080"; // flat height baseline
  ctx.fillRect(0, 0, size, size);
  if (kind === "turf") {
    // Vertical pile blades — short streaks with height jitter.
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const len = 5 + Math.random() * 16;
      const v = Math.round(128 + (Math.random() * 2 - 1) * 72);
      ctx.strokeStyle = `rgb(${v},${v},${v})`;
      ctx.lineWidth = 0.8 + Math.random() * 1.1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() * 2 - 1) * 1.4, y + len);
      ctx.stroke();
    }
  } else {
    // Isotropic grain speckle.
    for (let i = 0; i < 9000; i++) {
      const v = Math.round(128 + (Math.random() * 2 - 1) * 58);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 1.6, 1.6);
    }
  }
  const src = ctx.getImageData(0, 0, size, size).data;
  const out = ctx.createImageData(size, size);
  const H = (x: number, y: number) =>
    src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  const strength = kind === "turf" ? 2.6 : 1.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      out.data[i] = (nx * inv * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      out.data[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(Math.max(1, repeatX), Math.max(1, repeatY));
  tex.anisotropy = MAX_ANISOTROPY;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// Standard (PBR) material for a court surface plane. Sets the diffuse map to
// sRGB + anisotropic filtering (crisp at grazing angles) and a per-surface
// roughness: turf is matte (~0.9), hard courts (acrylic / PVC) keep a faint
// sheen (~0.55) so the sun leaves a soft highlight. Turf/hard finishes also
// get a tiling normal map for micro-relief (P3-02).
function surfaceMaterial(
  tex: THREE.CanvasTexture,
  opts: SurfaceMaterialOpts,
): THREE.MeshStandardMaterial {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = MAX_ANISOTROPY;

  const finish = opts.finish ?? "flat";
  // T2-1 — pull PBR from the FINISH_MATERIAL registry (ONE source of truth with
  // the 2D layer). Only a REAL finish counts: "plain"/undefined carries no
  // material intent, so the per-sport `roughness`/`finish` stay in charge and
  // legacy layouts render byte-for-byte as today (the additive fallback).
  const fm =
    opts.surface && opts.surface !== "plain"
      ? FINISH_MATERIAL[opts.surface]
      : undefined;
  const roughness = fm?.roughness ?? opts.roughness;
  const metalness = fm?.metalness ?? 0;
  const clearcoat = fm?.clearcoat ?? 0;
  const isTurf = finish === "turf";

  // T2-2 (turf mow sheen) + T2-3 (acrylic wet-gloss clearcoat) need a
  // MeshPhysicalMaterial; everything else stays MeshStandard (today's look).
  // MeshPhysical extends MeshStandard, so the return type + every caller are
  // unaffected. Wrapped in try/catch so any failure degrades to the plain
  // MeshStandard path instead of throwing.
  const wantPhysical = isTurf || clearcoat > 0;
  let mat: THREE.MeshStandardMaterial | null = null;
  if (wantPhysical) {
    try {
      const phys = new THREE.MeshPhysicalMaterial({
        map: tex,
        roughness,
        metalness,
        envMapIntensity: 0.5,
      });
      if (isTurf) {
        // T2-2 — velvety directional sheen so mow bands catch a real highlight
        // under the sun instead of reading as flat paint, plus an anisotropic
        // reflection aligned to the mow direction (registry stripeDirectionDeg,
        // 0 for the current turf finishes).
        phys.sheen = 0.6;
        phys.sheenRoughness = 0.55;
        phys.sheenColor = new THREE.Color(0xd9edbf);
        phys.anisotropy = 0.45;
        phys.anisotropyRotation = THREE.MathUtils.degToRad(
          fm?.stripeDirectionDeg ?? 0,
        );
      }
      if (clearcoat > 0) {
        // T2-3 — thin wet-look clearcoat over the acrylic coat (registry value).
        phys.clearcoat = clearcoat;
        phys.clearcoatRoughness = 0.12;
      }
      mat = phys;
    } catch {
      mat = null;
    }
  }
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness,
      metalness,
      envMapIntensity: 0.5,
    });
  }

  if (finish !== "flat" && opts.widthFt && opts.heightFt) {
    const tileFt = finish === "turf" ? 1.6 : 3.2; // real size of one normal tile
    const rx = Math.round(opts.widthFt / tileFt);
    const ry = Math.round(opts.heightFt / tileFt);
    mat.normalMap = makeSurfaceNormalTexture(
      finish === "turf" ? "turf" : "grain",
      rx,
      ry,
    );
    // Registry pile depth for turf (turf_40mm 0.8 / turf_50mm 0.9); faint grain
    // for hard courts. Both fall back to today's constants.
    const ns = finish === "turf" ? fm?.normalScale ?? 0.85 : 0.3;
    mat.normalScale = new THREE.Vector2(ns, ns);
  }
  if (opts.polygonOffsetUnits) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = opts.polygonOffsetUnits;
  }
  return mat;
}

// Alpha (cutout) texture for netting / chain-link (P3-03). White threads on a
// black ground → the black cells become see-through holes via alphaTest so the
// weave reads as real netting that light + sky pass through. "square" = sports
// nets, "diamond" = chain-link fence mesh.
function makeNetAlphaTexture(
  kind: "square" | "diamond",
  repeatX: number,
  repeatY: number,
): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000000"; // holes
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#ffffff"; // threads
  // T2-5 — round caps/joins + slightly thinner square threads so the weave
  // reads as an open net (clear holes) rather than a dense gauze sheet.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = kind === "diamond" ? 3 : 2.8;
  const step = 16;
  if (kind === "square") {
    for (let i = 0; i <= size; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }
  } else {
    for (let i = -size; i < size * 2; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + size, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i, size);
      ctx.lineTo(i + size, 0);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(Math.max(1, repeatX), Math.max(1, repeatY));
  tex.anisotropy = MAX_ANISOTROPY;
  return tex;
}

// Lit, alpha-cutout netting material (P3-03). Replaces the old flat
// MeshBasic membranes so nets catch the sun/sky and have real holes. alphaTest
// keeps it depth-correct (holes are discarded, not blended) so it receives
// shadow cleanly; castShadow is left off to avoid noisy per-thread shadows.
function netMaterial(
  color: number,
  spanFt: number,
  heightFt: number,
  kind: "square" | "diamond" = "square",
): THREE.MeshStandardMaterial {
  const cellFt = kind === "diamond" ? 0.9 : 0.5; // real mesh cell size
  const rx = Math.max(2, Math.round(spanFt / cellFt));
  const ry = Math.max(2, Math.round(heightFt / cellFt));
  // T2-5 — MeshPhysical so the sports-net weave carries a faint nylon sheen:
  // the threads catch a soft highlight and read as real netting instead of a
  // flat grey gauze. Chain-link (diamond) keeps its galvanised metalness.
  // MeshPhysical extends MeshStandard, so the return type + every caller are
  // unchanged; if it ever failed to build we still return a valid material.
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.85,
    metalness: kind === "diamond" ? 0.5 : 0.0,
    transparent: true,
    alphaMap: makeNetAlphaTexture(kind, rx, ry),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    envMapIntensity: kind === "diamond" ? 0.9 : 0.45,
  });
  if (kind === "square") {
    mat.sheen = 0.5;
    mat.sheenRoughness = 0.6;
    mat.sheenColor = new THREE.Color(0xffffff);
  }
  return mat;
}

// Plot-surface base — the whole plot rendered in its chosen flooring (turf
// stripes / acrylic / tile), matching the 2D PlotSurface. Without it, bare-
// pitch sports (cricket) and football run-off show grey ground in 3D instead
// of the turf/flooring the 2D plan draws. Returns null for "plain" earth.
function makePlotSurface(layout: CourtLayout): THREE.Object3D | null {
  const surface = layout.style.surface;
  if (!surface || surface === "plain") return null;
  const turf = isTurfSurface(surface);
  const baseColor =
    layout.style.surfaceColorOverride ??
    (turf ? layout.style.grassColor : SURFACE_SOLID_COLOR[surface]) ??
    "#2f8c3e";
  const Lft = layout.plot.lengthFt;
  const Wft = layout.plot.widthFt;
  const aspect = Lft / Math.max(1, Wft);
  const cw = 1600;
  const ch = Math.max(1, Math.round(cw / aspect));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const cx = c.getContext("2d")!;
  if (turf && layout.style.grassStripes !== false) {
    // Mowed-stripe turf (parity with the 2D plan + the football field tone).
    const stripes = 12;
    const sw = cw / stripes;
    for (let i = 0; i < stripes; i++) {
      cx.fillStyle = i % 2 === 0 ? baseColor : darken(baseColor, 0.1);
      cx.fillRect(i * sw, 0, sw + 1, ch);
    }
  } else {
    cx.fillStyle = baseColor;
    cx.fillRect(0, 0, cw, ch);
    if (isTiledSurface(surface)) {
      // Faint tile grid for PPE tile flooring.
      cx.strokeStyle = "rgba(0,0,0,0.14)";
      cx.lineWidth = 2;
      const cell = cw / 20;
      for (let x = cell; x < cw; x += cell) {
        cx.beginPath();
        cx.moveTo(x, 0);
        cx.lineTo(x, ch);
        cx.stroke();
      }
      for (let y = cell; y < ch; y += cell) {
        cx.beginPath();
        cx.moveTo(0, y);
        cx.lineTo(cw, y);
        cx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  const mat = surfaceMaterial(tex, {
    roughness: turf ? 0.92 : 0.6,
    finish: turf ? "turf" : isTiledSurface(surface) ? "hard" : "flat",
    // T2-1 — the plot base is itself a real finish; feed it so acrylic gets
    // wet-gloss clearcoat and turf gets the mow sheen from the registry.
    surface,
    widthFt: Lft,
    heightFt: Wft,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(Lft, Wft), mat);
  mesh.rotation.x = -Math.PI / 2;
  // Just below the court elements (which sit at local y >= 0) and above both
  // the base-work pad top (~ -0.04) and the ground plane (world y = -0.05).
  mesh.position.y = -0.02;
  mesh.receiveShadow = true;
  return mesh;
}

// Subtle tonal break-up for the surrounding earth so the big ground
// plane doesn't read as flat plastic. Soft light/dark blotches around
// the base colour, tiled across the plane.
function groundNoiseTexture(baseHex: number): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const base = new THREE.Color(baseHex);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, size, size);
  // Very subtle mottling — just enough tonal life to avoid a flat-plastic
  // look, biased slightly lighter so it never reads as dark patches.
  for (let i = 0; i < 1400; i++) {
    const col = base.clone();
    col.offsetHSL(0, (Math.random() - 0.5) * 0.04, (Math.random() - 0.35) * 0.09);
    const r = Math.round(col.r * 255);
    const g = Math.round(col.g * 255);
    const b = Math.round(col.b * 255);
    ctx.fillStyle = `rgba(${r},${g},${b},0.3)`;
    ctx.beginPath();
    ctx.arc(
      Math.random() * size,
      Math.random() * size,
      2 + Math.random() * 4,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(30, 30);
  tex.anisotropy = MAX_ANISOTROPY;
  return tex;
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
  const grassColor =
    layout.style.surfaceColorOverride ?? el.grassColor ?? layout.style.grassColor;
  const lineColor = el.lineColor ?? layout.style.lineColor;
  const lineWidth = Math.max(4, w * 0.0045);
  // Mowed-stripe pattern — parity with 2D: honour the grassStripes toggle
  // (solid fill when off) and the picked surface colour above.
  if (layout.style.grassStripes === false) {
    ctx.fillStyle = grassColor;
    ctx.fillRect(0, 0, w, h);
  } else {
    const stripes = 10;
    const stripeW = w / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? grassColor : darken(grassColor, 0.1);
      ctx.fillRect(i * stripeW, 0, stripeW, h);
    }
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
  tex.anisotropy = MAX_ANISOTROPY;
  return tex;
}

function cricketTexture(el: CricketPitchElement, layout: CourtLayout): THREE.CanvasTexture {
  const aspect = el.pitchLengthFt / el.pitchWidthFt;
  // P3-07: doubled from 256 → 512 px so crease lines + stumps stay crisp when
  // the (small) pitch fills much of the frame in an eye-level view.
  const h = 512;
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
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
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
  tex.anisotropy = MAX_ANISOTROPY;
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
  // Honour the picked surface colour (global override) so the 3D court
  // matches the 2D plan — 2D resolves el.surfaceColor ?? surfaceColorOverride
  // ?? sport default, so 3D must too.
  ctx.fillStyle =
    el.surfaceColor ??
    layout.style.surfaceColorOverride ??
    layout.style.basketballSurfaceColor;
  ctx.fillRect(0, 0, w, h);
  // Per-area highlight fill (parity with 2D) — jump-ball / centre circle,
  // behind the markings, at 55% so the surface shows through.
  if (!el.halfCourt && layout.style.basketballCircleColor) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = layout.style.basketballCircleColor;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
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
    // Per-area highlight fills (parity with 2D) — 3-point D + free-throw key,
    // behind the markings.
    if (layout.style.basketball3ptColor) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = layout.style.basketball3ptColor;
      ctx.beginPath();
      ctx.moveTo(cx, h / 2);
      ctx.arc(
        cx,
        h / 2,
        threeR,
        dir < 0 ? -Math.PI / 2 : Math.PI / 2,
        dir < 0 ? Math.PI / 2 : -Math.PI / 2,
        false,
      );
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (layout.style.basketballKeyColor) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = layout.style.basketballKeyColor;
      ctx.fillRect(keyX, (h - keyH) / 2, keyW, keyH);
      ctx.globalAlpha = 1;
    }
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
  tex.anisotropy = MAX_ANISOTROPY;
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
  ctx.fillStyle =
    el.surfaceColor ??
    layout.style.surfaceColorOverride ??
    layout.style.pickleballSurfaceColor;
  ctx.fillRect(0, 0, w, h);
  // Kitchen (non-volley zone) fill — parity with 2D. The band around the net;
  // "none" turns it off, else the chosen colour / pickleball default.
  const kitchenColor =
    layout.style.kitchenColor === "none"
      ? null
      : layout.style.kitchenColor ?? "#C0563B";
  if (kitchenColor) {
    const kb = w * 0.16;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = kitchenColor;
    ctx.fillRect(w / 2 - kb, 0, kb * 2, h);
    ctx.globalAlpha = 1;
  }
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
  tex.anisotropy = MAX_ANISOTROPY;
  return tex;
}

function genericCourtTexture(
  el: GenericCourtElement,
  layout: CourtLayout,
): THREE.CanvasTexture {
  const aspect = el.width / el.height;
  // P3-07: raised 600 → 1024 px so tennis/volleyball/badminton lines stay
  // sharp at eye level; round caps/joins soften the stroke edges.
  const h = 1024;
  const w = Math.round(h * aspect);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  // Tennis / volleyball / badminton and other generic hard courts also
  // follow the picked surface colour, matching the 2D plan.
  ctx.fillStyle =
    el.surfaceColor ?? layout.style.surfaceColorOverride ?? "#5a8a6c";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = el.lineColor ?? "#ffffff";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeRect(0, 0, w, h);
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = MAX_ANISOTROPY;
  return tex;
}

// ─────────────────────────────────────────────────────────────────────
//  Dimension labels — canvas-textured Three.js sprites
// ─────────────────────────────────────────────────────────────────────

function makeDimensionSprite(text: string, worldWidth = 16): THREE.Sprite {
  const W = 512;
  const H = 188;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);
  // Solid white pill FILLING the label (no transparent band above/below that
  // read as a dark layer) + extra-bold black numbers. depthWrite:false so the
  // transparent rounded corners leave no dark fringe.
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 8, 8, W - 16, H - 16, 42);
  ctx.fill();
  ctx.strokeStyle = "rgba(15,23,42,0.22)";
  ctx.lineWidth = 4;
  roundRect(ctx, 8, 8, W - 16, H - 16, 42);
  ctx.stroke();
  ctx.fillStyle = "#0b1220";
  ctx.font = "800 112px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2 + 6);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = MAX_ANISOTROPY;
  // NO mipmaps — mip-averaging the transparent corners with the white pill
  // produced the dark halo / "black box" the user saw. Linear filtering only.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(worldWidth, worldWidth * (H / W), 1);
  return sp;
}

// CAD-style linear dimension drawn FLAT on the ground just outside the plot:
// a witness line out from each end of the measured edge, a dimension line
// between them with an arrowhead at each end, and the measurement label
// centred above it. Sits outside the footprint so it never overlaps the pitch
// or goals. `a`/`b` are the two measured-edge corners (y ignored); `outDir` is
// the unit outward direction (in the XZ plane); `offset` how far out it sits.
function makeDimensionLine(
  a: THREE.Vector3,
  b: THREE.Vector3,
  outDir: THREE.Vector3,
  offset: number,
  label: string,
  scale: number,
): THREE.Group {
  const g = new THREE.Group();
  const y = 0.35;
  const mat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
  const off = outDir.clone().setY(0).normalize().multiplyScalar(offset);
  const a0 = new THREE.Vector3(a.x, y, a.z);
  const b0 = new THREE.Vector3(b.x, y, b.z);
  const aO = a0.clone().add(off);
  const bO = b0.clone().add(off);
  const barW = Math.max(0.25, scale * 0.015);
  // A thin flat bar (box) laid on the ground from p to q.
  const bar = (p: THREE.Vector3, q: THREE.Vector3) => {
    const d = new THREE.Vector3().subVectors(q, p);
    const m = new THREE.Mesh(new THREE.BoxGeometry(d.length(), 0.12, barW), mat);
    m.position.copy(p).add(q).multiplyScalar(0.5);
    m.position.y = y;
    m.rotation.y = Math.atan2(-d.z, d.x);
    return m;
  };
  g.add(bar(a0, aO)); // witness line, end A
  g.add(bar(b0, bO)); // witness line, end B
  g.add(bar(aO, bO)); // dimension line
  const along = new THREE.Vector3().subVectors(bO, aO).normalize();
  const arrow = (pos: THREE.Vector3, dir: THREE.Vector3) => {
    const h = Math.max(1.2, scale * 0.22);
    const c = new THREE.Mesh(new THREE.ConeGeometry(h * 0.38, h, 14), mat);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); // apex → dir
    c.position.copy(pos).addScaledVector(dir, -h / 2); // apex sits at `pos`
    c.position.y = y;
    return c;
  };
  g.add(arrow(aO, along.clone().negate())); // arrowhead pointing outward at A
  g.add(arrow(bO, along)); // arrowhead pointing outward at B
  const mid = aO.clone().add(bO).multiplyScalar(0.5);
  const sprite = makeDimensionSprite(label, scale);
  sprite.position.set(mid.x, 2.2, mid.z);
  g.add(sprite);
  return g;
}

// ─────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────

// Material.dispose() frees the shader program but NOT the textures bound to it.
// Every court / ground / plot / sprite / fence surface here carries a
// per-build CanvasTexture in `.map`, so disposing only the material leaked
// those textures on every layout rebuild and on unmount. Free the maps first,
// then the material.
function disposeMaterial(mat: THREE.Material) {
  const m = mat as THREE.Material & {
    map?: THREE.Texture | null;
    alphaMap?: THREE.Texture | null;
    normalMap?: THREE.Texture | null;
    roughnessMap?: THREE.Texture | null;
  };
  m.map?.dispose();
  m.alphaMap?.dispose();
  m.normalMap?.dispose();
  m.roughnessMap?.dispose();
  mat.dispose();
}

function disposeGroup(group: THREE.Object3D) {
  group.traverse((obj) => {
    if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
    const mat = (obj as THREE.Mesh).material;
    if (Array.isArray(mat)) mat.forEach(disposeMaterial);
    else if (mat) disposeMaterial(mat as THREE.Material);
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
