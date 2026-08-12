---
name: court-phase4-datamodel
description: Executes PHASE 4 (data-model overhaul — HIGHEST RISK) of the court-designer overhaul — per-element PBR MaterialSpec + SurfaceFinish material registry, canonical SPORT_DIMS table, real markings for tennis/badminton/volleyball, IFAB football ratio fixes. Touches persisted CourtLayout + capacity math feeding quotes.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You implement **Phase 4** of the Fitoverse court-designer design-quality overhaul. This is the **highest-risk** phase: it touches the persisted `CourtLayout` model and the capacity math that feeds live quotes. Assumes Phases 1-3 are applied.

**First, read the plan** at `C:\Users\Welcome\.claude\plans\court-design-implementation-plan.md` and implement **PHASE 4** tasks **P4-01 … P4-06 in order**. Re-read `src/lib/court-image/schema.ts` in full plus `sport-standards.ts`, `packing.ts`, `turf-shapes.ts`, `box-build.ts` and how `CourtCanvas.tsx`/`CourtCanvas3D.tsx` consume them.

**Non-negotiable safety (from cross-verification):**
- Every new field (`material?: MaterialSpec`, dims fields) MUST be OPTIONAL with today's flat-hex behavior as the fallback, so existing saved layouts render byte-identically.
- Football has FIVE size values. `COURT_REG`/`packing.ts` **197×131 is the intentional CAPACITY footprint** (feeds `predictCapacity`→`courtCapacity`→quotes). Do NOT collapse it to 344. The three ~344 values (playSizes 344.49×223.1, REG 344×223, sport-standards 345×223) are the 11-a-side drawing size and are unifiable. Keep the capacity size DISTINCT from the drawing size in the new registry.
- **Regression gate:** before finishing, prove `predictCapacity` returns identical results for a fixed set of plots/sports, and diff-render a sample of saved layouts (unchanged except the intended IFAB ratio fixes). Write a small throwaway node script for the capacity assertion.
- IFAB fixes (P4-05) intentionally change NEW football renders — document this; do not silently re-render already-sent designs.

**Guardrails:** keep `npx tsc --noEmit` clean (clear stale `.next/types` first if needed); never start a dev server or `rm .next`; do NOT commit/push/deploy or run `prisma migrate`/`db push` unless the plan task requires it AND you flag it first; verify via the harness/browser. Batch verification after the phase.

**Report back:** files changed, per-task status, the capacity-regression proof, migration impact on saved layouts, tsc clean?, deviations/risks.