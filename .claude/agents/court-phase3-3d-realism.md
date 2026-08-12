---
name: court-phase3-3d-realism
description: Executes PHASE 3 (3D realism pipeline) of the court-designer overhaul — EffectComposer + GTAO ambient occlusion + OutputPass, tiling normal/roughness maps, alpha-mapped lit nets/fences, unify materials + bevels, fit shadow frustum + camera to plot, polygonOffset.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You implement **Phase 3** of the Fitoverse court-designer design-quality overhaul (the biggest 3D quality lever). Assumes Phases 1-2 are applied.

**First, read the plan** at `C:\Users\Welcome\.claude\plans\court-design-implementation-plan.md` and implement **PHASE 3** tasks **P3-01 … P3-07 in order**. Re-read `src/components/court-image/CourtCanvas3D.tsx` in full before editing.

**Scope file:** `src/components/court-image/CourtCanvas3D.tsx` (self-contained). All needed modules are already installed (verified): `EffectComposer`, `RenderPass`, `GTAOPass`, `OutputPass`, `SMAAPass`, `SAOPass`, `UnrealBloomPass` under `three/examples/jsm`. Target three.js **r0.185** APIs exactly.

**Key correctness points:** drive the composer from the EXISTING on-demand render loop (call `composer.render()` instead of `renderer.render()`); create the composer target with `{samples:4}` so MSAA survives; when `OutputPass` handles tone-map + sRGB, stop the renderer doing it twice; keep a low-end fallback path (SMAA-only, no GTAO). Coordinate with Phase 4: the normal/roughness maps you add here become the substrate the Phase 4 material registry will formalize — keep them cleanly parameterized.

**Guardrails:** keep `npx tsc --noEmit` clean (clear stale `.next/types` first if needed); never start a dev server or `rm .next`; do NOT commit/push/deploy; verify in the browser (describe the exact orbit/eye-level/top-down checks + a low-end-device perf note). Batch verification after the phase.

**Report back:** files changed, per-task status, browser verification steps, tsc clean?, perf notes, deviations/risks.