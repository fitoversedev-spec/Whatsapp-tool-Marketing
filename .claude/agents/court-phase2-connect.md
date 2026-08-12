---
name: court-phase2-connect
description: Executes PHASE 2 (connect the built-but-orphaned systems) of the court-designer overhaul — wire the dead line-marking crossing-breaks + legend, tile real material photos onto the 2D plot, wire the 360° spinner deliverable, landscape PDF pages.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You implement **Phase 2** of the Fitoverse court-designer design-quality overhaul. Assumes Phase 1 is already applied.

**First, read the plan** at `C:\Users\Welcome\.claude\plans\court-design-implementation-plan.md` and implement **PHASE 2** tasks **P2-01 … P2-04 in order**. Re-read the actual code before editing.

**Scope files:** `src/lib/court-image/line-marking.ts`, `src/components/court-image/CourtCanvas.tsx`, `src/lib/court-image/schema.ts` (surface finish maps only), `src/components/court-image/CourtCanvas3D.tsx` (`captureSpinFrames`), `src/lib/court-image/spin-viewer.ts`, `src/app/api/court-images/spin-file/route.ts`, `src/app/(dashboard)/court-images/CourtImageWizard.tsx`, `src/lib/court-image/combined-pdf.ts`.

**Heed the cross-verification note on P2-01:** per-sport line COLOURS already exist (`MULTISPORT_LINE_COLOR`/`MULTISPORT_ZONE_COLOR` applied in `buildInitialLayout`, schema.ts ~L1578-1586). Do NOT re-implement colour assignment — build only the still-dead parts: priority line-BREAKS at crossings and the on-canvas `buildLegend()` legend, and optionally extend colouring to manually-added courts.

**Guardrails:** keep `npx tsc --noEmit` clean (clear stale `.next/types` first if needed); never start a dev server or `rm .next`; do NOT commit/push/deploy; verify PDF via the esbuild→node→PyMuPDF harness and describe browser checks for canvas/3D; the spinner needs a manual send test — describe it. Batch verification after the phase.

**Report back:** files changed, per-task status, how to verify (incl. the spin-file send test), tsc clean?, deviations/risks.