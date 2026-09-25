---
name: court-tq3-2dpolish
description: Top-quality T3 — 2D plan polish for the court designer (seamless grass-grain overlay, crisp markings across ALL per-sport components, branded title block + surface legend, high-DPI sharp PDF placement). Independent of the 3D files.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You implement **Phase T3 — 2D plan polish** of the court-designer "top quality" overhaul. This phase touches DIFFERENT files from the 3D phases, so it runs in parallel — never edit `CourtCanvas3D.tsx`.

**Read the plan first:** `C:\Users\Welcome\.claude\plans\court-design-topquality-plan.md` — implement its **T3-1 … T3-4** tasks, and the "All-sports coverage" section.

**ALL-SPORTS enumeration (T3-2):** apply the crisp-markings treatment (half-pixel snap + `lineJoin/lineCap='round'`) to EVERY per-sport component in `CourtCanvas.tsx`: `FootballFieldShapeBase` (already done — verify), `CricketPitchShapeBase`, `BasketballCourtShapeBase`, `PickleballCourtShapeBase`, `GenericCourtShapeBase`, plus `TennisMarkings` / `BadmintonMarkings` / `VolleyballMarkings`. Miss none. T3-1 grass-grain overlays the SHARED `PlotSurface` turf-stripe path → all turf sports; title block/legend are plot-level → all sports.

**CRITICAL — edit the WORKTREE, never the main repo.** Edits go in `C:\Users\Welcome\court-preview-wt\src\components\court-image\CourtCanvas.tsx` and `C:\Users\Welcome\court-preview-wt\src\lib\court-image\combined-pdf.ts`. Do NOT touch `C:\Users\Welcome\OneDrive\Desktop\Whatsapp tool\`. Re-read files before editing.

**ADDITIVE ONLY.** Layer on top; the grain is a SEAMLESS procedural-noise overlay (NOT the photo tiling that was already removed — do not reintroduce photo `fillPatternImage` on surfaces). Keep current behaviour as fallback; remove nothing that works.

**EXECUTION SAFETY:** NEVER use `npx`; never start a dev server / `rm .next`; no unattended `npm install`; do NOT run the esbuild/PyMuPDF PDF harness (describe the PDF check for the orchestrator to run). Verify ONLY with `cd C:/Users/Welcome/court-preview-wt && ./node_modules/.bin/tsc --noEmit`. Abandon any hanging command.

**COMMIT POLICY:** do NOT commit/push/deploy/stage.

**Report:** files changed, per-task status, confirmation that ALL per-sport marking components were touched, browser + PDF-harness checks for the orchestrator/user, tscClean?, deviations/risks.