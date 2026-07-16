# CRM build — open data gaps

Business inputs the spec explicitly flags as needing to come from Fitoverse, not be guessed. Everything here ships nullable/empty with an admin-editable path to fill it in later — nothing on this list blocks a phase from shipping, but the features listed as "affects" won't be fully meaningful until it's resolved. Surfaced in-app as a "Setup incomplete" banner once the admin UI exists (Phase 1+).

Status: ⬜ open · ✅ resolved (move resolved items to the bottom with the date + who confirmed it)

| # | Gap | Affects | Status |
|---|---|---|---|
| 1 | City → tier mapping (which cities are Tier 1/2/3) | Geography analytics tier rollup | ⬜ |
| 2 | Project-value bands (the cutoffs for "small/medium/large" project filters) | Value-band filtering across all analytics | ⬜ |
| 3 | Funnel stage win-probabilities (for weighted forecast) | `/forecast` — renders unweighted with a note until set | ⬜ (admin UI to set it now exists — Taxonomies → Funnel Stages → "Win prob %", 2026-07-16 — still needs real values entered) |
| 4 | Stage SLA hours (stuck-deal threshold) | Stuck-deal detection — uses a single configurable global default until set | ⬜ (admin UI to set it now exists — Taxonomies → Funnel Stages → "SLA (hrs)", 2026-07-16 — still needs real values entered) |
| 5 | The eleven blank product rates (PP tiles, PVC flooring, indoor structural, indoor lighting, 5× sport-specific equipment categories, safety pads, accessories) | Quotation builder shows "rate to be confirmed" for these, never ₹0 | ⬜ |
| 6 | Concrete and asphalt sub-base rates | Carried over as an existing open TODO from the quotation module | ⬜ |
| 7 | House line-colour defaults (football white / cricket red / pickleball blue / basketball white-black) | Court designer defaults | ⬜ |
| 8 | CustomerProfile → businessType default mapping (which profiles default to B2B vs B2C vs B2G) | Account creation defaults | ⬜ |
| 9 | Ad spend data availability (monthly, per lead source) | `/sources` cost-per-lead/CAC/ROAS — columns stay visible but empty until supplied | ⬜ (`AdSpend` schema + `sourceAnalytics()` calculation already exist; only the admin entry UI is missing. Explicitly deprioritized by Fitoverse, 2026-07-16 — "don't need ad spend" — not building the entry screen until asked) |
| 10 | Competitor tracking — do we record who a deal was lost to? | `Deal.competitorName` — not yet added to schema pending this answer | ⬜ |
| 11 | Reminder default offsets per activity type | Only site-visit `[1440,120]` and Google Meet `[1440,15]` are seeded; others TODO | ⬜ |
| 12 | Deal code format (`FIT-DL-2026-0142` is a proposal from the spec, not confirmed) | Deal numbering | ⬜ |
| 13 | Financial year (assumed April–March) | Date-range presets ("This FY") | ⬜ |
| 14 | Historical data migration scope — is there real historical deal/quotation data beyond what's already in this app's DB to bring in? | Whether seasonality analytics are usable at launch | ✅ (2026-07-15) |

Additionally (found during Phase 0-2 reconciliation, not in the original spec list):

| # | Gap | Affects | Status |
|---|---|---|---|
| 16 | `gstMode: "FLAT_18"` compute semantics — what a flat-rate quote actually means operationally | Column exists, defaults to `"SPLIT"` (today's behavior), flat-rate calculation unimplemented | ⬜ |
| 17 | Should individual sales reps see their own "My Day" landing (spec §11.3.A)? `/team` is hard-gated admin-only today (predates this build), and that page's Sales Activity tab ranks every rep against their peers — opening rep access means either building a role-scoped view of the *same* page (peer numbers hidden from non-admins) or a separate route, both real product decisions | Phase 4 screen 9 (`/dashboard`) ships Manager/Management-only ("Overview" tab); the personal rep view is not built | ⬜ |
| 20 | Error tracking (spec §14: Sentry) needs a Sentry account + DSN — an external signup only Fitoverse/the developer can do. Code-side integration (`@sentry/nextjs`, wiring) is a ~30 min follow-up once a DSN exists | No error tracking beyond `console.error`/Vercel's own function logs today | ⬜ |
| 21 | Daily automated DB backup + a tested restore procedure (spec §14) — Neon (the DB host) provides automated backups by default, but retention window depends on the plan tier, which hasn't been confirmed. The restore-procedure test itself is a real, somewhat risky drill (restoring a snapshot to verify it works) that needs explicit sign-off before attempting, even against a branch | Backup exists in some form via Neon; retention + a tested restore are unconfirmed | ⬜ |
| 22 | Sales-team UAT (spec §12 Phase 6 exit: "signed off for go-live") is a human process — Fitoverse's own sales team actually using the built CRM day-to-day and reporting what's broken/confusing. Not something buildable in this session; the natural next step once everything here is pushed live | Formal go-live sign-off | ⬜ |
| 23 | `AnalyticsFilter`'s `leadSourceIds`/`customerProfileIds`/`stageIds`/`outcomes` fields are typed but implemented in zero analytics functions (only `ownerIds` is real — see docs/DECISIONS.md's 2026-07-16 "owner filter" entry). Building real support means bespoke filter logic per screen, not a single shared change — e.g. "filter by lead source" means something structurally different in `sources.ts` (already groups BY source) than in `geography.ts` (doesn't reference source at all). Worth scoping properly with which specific screens/dimensions matter most, rather than building all 4×8 combinations speculatively | Team Performance's 8 filterable screens can currently only be sliced by date range + rep, not by source/customer profile/stage/outcome | ⬜ |

**Correction (2026-07-15):** #15 originally said `CustomerProfile`/`CityTier`/`LossReason` would ship empty — that was wrong for two of the three. `CustomerProfile` (16 values) and `LossReason` (12 values) are both directly spec-supplied (§4.2, §5.4) and are now seeded in full via `scripts/seed-taxonomies.ts`, along with `FunnelStage` (13), `LeadSource` (19), and `ActivityType` (13) — all real spec content, not placeholders. Only `CityTier` ships partially empty: the 3 generic tier labels (Tier 1/2/3) are seeded, but gap #1 above (which real city belongs to which tier) is still open.

**Resolved/declined (2026-07-16), moved from the open table above:**

| # | Gap | Resolution |
|---|---|---|
| 18 | `manager`/`management` roles exist but have no differentiated permissions anywhere except the audit log. | **Declined by explicit Fitoverse instruction** — "no need for manager." Not building office-scoping, reassign-owner, or role-aware `/team` access; `manager`/`management` stay functionally identical to `sales` going forward, by decision rather than by remaining gap. |
| 19 | Rate-sheet edit access conflict — spec wanted admin-only, existing behavior allowed sales too. | **Resolved by explicit Fitoverse instruction** — "the quotation rate sheet only change by admin." `PUT /api/quotations/rates` and `/settings/quotation-rates` are now admin-gated; `GET` (viewing rates while quoting) stays open to sales. |
