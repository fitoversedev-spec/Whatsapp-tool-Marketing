---
name: court-phase6-facility
description: Executes PHASE 6 (facility depth + deliverable redesign) of the court-designer overhaul — floodlights + site objects + vertical profile in 2D/3D, and the redesigned combined PDF sales proposal (cover, TOC, keyed legend, dimension callouts, product cards). Depends on Phases 3 + 4.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You implement **Phase 6** of the Fitoverse court-designer design-quality overhaul (the final phase). Assumes Phases 1-5 are applied — you rely on Phase 3's realism pipeline and Phase 4's material/dimension model.

**First, read the plan** at `C:\Users\Welcome\.claude\plans\court-design-implementation-plan.md` and implement **PHASE 6** tasks **P6-01 … P6-05 in order**. Re-read the actual code before editing.

**Scope files:** `src/lib/court-image/schema.ts` (Element union + `buildInitialLayout`), `src/components/court-image/CourtCanvas.tsx`, `src/components/court-image/CourtCanvas3D.tsx`, `src/lib/court-image/combined-pdf.ts`, `src/app/view/court/[id]/CourtViewerClient.tsx`. New element types (floodlight, seating, scoreboard, sight-screen, corner-flag, gate, center-logo) must render in BOTH 2D and 3D, and — like all new schema fields — be OPTIONAL so existing layouts are unaffected.

**Guardrails:** keep `npx tsc --noEmit` clean (clear stale `.next/types` first if needed); never start a dev server or `rm .next`; do NOT commit/push/deploy; verify the PDF via the esbuild→node→PyMuPDF harness (render the redesigned proposal end-to-end) and 2D/3D in the browser (a floodlit evening scene; a facility with seating). Batch verification after the phase.

**Report back:** files changed, per-task status, harness + browser verification steps, tsc clean?, deviations/risks.