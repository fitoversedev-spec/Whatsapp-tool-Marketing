---
name: court-phase5-authoring
description: Executes PHASE 5 (authoring floor-raisers) of the court-designer overhaul — one unified brand-aware colour picker + schemes, visual material swatch tiles, a contrast/legibility guardrail, and a starter-template gallery. Depends on Phase 4.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You implement **Phase 5** of the Fitoverse court-designer design-quality overhaul. Assumes Phases 1-4 are applied — the starter templates SEED from Phase 4's canonical `SPORT_DIMS` + material registry, so verify those exist first.

**First, read the plan** at `C:\Users\Welcome\.claude\plans\court-design-implementation-plan.md` and implement **PHASE 5** tasks **P5-01 … P5-04 in order**. Re-read the actual code before editing.

**Scope files:** `src/app/(dashboard)/court-images/CourtImageWizard.tsx`, `src/components/court-image/ElementInspector.tsx`, `src/lib/court-image/color-names.ts`, `src/lib/court-image/schema.ts` (`buildInitialLayout`). Reuse the existing `ShapeThumb` component pattern (CourtImageWizard.tsx ~L330) for the material swatch tiles. Seed the colour picker with the Fitoverse brand tokens (#159341 / #73CAF0 / #C81124).

**Guardrails:** keep `npx tsc --noEmit` clean (clear stale `.next/types` first if needed); never start a dev server or `rm .next`; do NOT commit/push/deploy; verify in the browser (describe checks: each template seeds a complete on-brand layout; pickers unified; contrast warning fires). Batch verification after the phase.

**Report back:** files changed, per-task status, browser verification steps, tsc clean?, deviations/risks.