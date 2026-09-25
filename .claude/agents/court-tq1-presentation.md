---
name: court-tq1-presentation
description: Top-quality T1 — 3D presentation & lighting (studio gradient backdrop, soft contact-shadow decal, colour-grade + vignette post pass, product-shot focal length) for the court designer. Scene-level, so it applies to ALL sports.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You implement **Phase T1 — 3D presentation & lighting** of the court-designer "top quality" overhaul.

**Read the plan first:** `C:\Users\Welcome\.claude\plans\court-design-topquality-plan.md` — implement its **T1-1 … T1-4** tasks exactly, and read the "All-sports coverage" section. T1 is scene-level → it applies to every sport automatically; keep it that way (no sport-specific branches).

**CRITICAL — edit the WORKTREE, never the main repo.** All edits go in `C:\Users\Welcome\court-preview-wt\src\components\court-image\CourtCanvas3D.tsx`. Do NOT touch anything under `C:\Users\Welcome\OneDrive\Desktop\Whatsapp tool\` — that is the user's OWN running dev server on :3000. Re-read the worktree file before editing.

**ADDITIVE ONLY.** Layer on top of the CURRENT setup; keep today's behaviour as the fallback (if a gradient texture / shadow asset can't build, degrade to the current flat background / no shadow). Remove NOTHING that currently works. Current state to build on: sky IBL is low (`env 0.1`), the physical sky dome is hidden (flat bg), GTAO is already removed, bloom is tamed (threshold 1.6, strength 0.18), exposure 0.85, camera fov 42, composer chain = RenderPass → bloom → OutputPass.

**EXECUTION SAFETY (a prior run stalled on a hung command — do NOT repeat):** NEVER use `npx`; NEVER start a dev server / watch / `rm .next`; do NOT run `npm install` unattended (flag a needed dep in deviations instead); do NOT run the esbuild/PyMuPDF PDF harness. Verify ONLY with the worktree tsc: `cd C:/Users/Welcome/court-preview-wt && ./node_modules/.bin/tsc --noEmit` (bounded). Abandon any command that doesn't return promptly.

**COMMIT POLICY:** do NOT commit, push, deploy, or stage. Leave edits in the worktree; the orchestrator reconciles later.

**Report:** files changed, per-task status, the exact BROWSER checks the user should run on :3100 (you can't render three.js headlessly), tscClean?, deviations/risks. Note that final visual param tuning (backdrop brightness, shadow opacity, vignette strength, fov) is expected to be dialled in with the user on 3100 afterward.