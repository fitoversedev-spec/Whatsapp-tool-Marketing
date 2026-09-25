---
name: court-tq2-materials
description: Top-quality T2 — 3D materials for the court designer (wire FINISH_MATERIAL PBR into ALL court surfaces incl. the hard-court finish:"flat" fix, turf mow sheen, wet-look acrylic, brushed-metal goals, refined nets). Covers every sport.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You implement **Phase T2 — 3D materials** of the court-designer "top quality" overhaul. **Phase T1 is already applied to `CourtCanvas3D.tsx`; build on top of it.**

**Read the plan first:** `C:\Users\Welcome\.claude\plans\court-design-topquality-plan.md` — implement its **T2-1 … T2-5** tasks, and the "All-sports coverage" section.

**ALL-SPORTS is the point of this phase.** Every court builds its texture then calls the SHARED `surfaceMaterial()` (calls at ~L1267/1298/1322/1337/1352 + plot surface L2383; def L2224) — so edit `surfaceMaterial` to read `roughness/metalness/clearcoat/sheen/normalScale/anisotropy` from the `FINISH_MATERIAL` registry in `schema.ts`. **Critical fix:** the hard courts (basketball/pickleball/generic-court → tennis/badminton/volleyball) currently pass `finish:"flat"`, so they ignore their real surface — route the actual plot `style.surface` into every court's `surfaceMaterial` call so acrylic gloss / PPE tile / turf realism shows on THOSE sports too, not just football/cricket. `makeGoalPost` / `makeNet` / `makeBasketballHoop` are element builders → cover every sport using them.

**CRITICAL — edit the WORKTREE, never the main repo.** Edits go in `C:\Users\Welcome\court-preview-wt\src\components\court-image\CourtCanvas3D.tsx` (and, only if a new PBR field is genuinely needed, `C:\Users\Welcome\court-preview-wt\src\lib\court-image\schema.ts`). Do NOT touch `C:\Users\Welcome\OneDrive\Desktop\Whatsapp tool\`. Re-read files before editing.

**ADDITIVE ONLY.** Keep current behaviour as the fallback; if a MeshPhysical feature isn't available, fall back to the current MeshStandard look. Remove nothing that works.

**EXECUTION SAFETY:** NEVER use `npx`; never start a dev server / `rm .next`; no unattended `npm install` (flag it); no PDF harness. Verify ONLY with `cd C:/Users/Welcome/court-preview-wt && ./node_modules/.bin/tsc --noEmit`. Abandon any hanging command.

**COMMIT POLICY:** do NOT commit/push/deploy/stage.

**Report:** files changed, per-task status, per-sport/finish coverage confirmation, browser checks for :3100, tscClean?, deviations/risks.