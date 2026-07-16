# CRM build — decisions log

Per the build spec's own rule (§0.5): when a spec requirement conflicts with something already built, the conflict is raised and reasoned through here rather than silently changed. Newest entries at the top.

---

## 2026-07-16 — Team Performance owner filter: the "Timelines only slices by owner" claim was wrong — nothing did

Continuing the same batch below, user confirmed skipping the AdSpend entry screen, manager/management roles, and Tier 4 (all correctly out of scope — external accounts or business data this session can't supply), and asked to continue on the rest. The remaining item was Tier 3 #11: "Timelines only slices by owner, not the other 8 dimensions." Investigating it properly (rather than assuming my own earlier note was accurate) found the premise was wrong.

`AnalyticsFilter` (`src/lib/analytics/types.ts`) declares 5 optional dimensions: `ownerIds`, `leadSourceIds`, `customerProfileIds`, `stageIds`, `outcomes`. Audited every one of the 9 Phase-4 analytics functions directly: **all 8 that accept a filter already implement `ownerIds`** (each has its own `ownerWhere` guard) — but `leadSourceIds`/`customerProfileIds`/`stageIds`/`outcomes` are referenced nowhere in any function body, anywhere. They were typed and never built. Worse: `src/app/api/team/analytics/route.ts` — the one and only call site for all 9 functions — never parsed any filter query param except `range`, and called every function with just `{from, to}`. So the working `ownerIds` support inside every function was completely unreachable; Team Performance's 8 filterable screens (sales-activity/funnel/geography/customers/products/sources/timelines/forecast) only ever rendered whole-team numbers, with no way to drill into one rep, despite the per-function code implying otherwise. (The stale comment at the old `forecast()` call site — "the range picker still scopes it via ownerIds" — was itself evidence nobody had checked this in a while.)

**Fixed the real, well-defined part: `ownerIds` end-to-end.** `route.ts` now parses an `owner` query param (`"all"` or a userId) and passes `ownerIds` through to all 8 functions. Added a "Rep" dropdown to `TeamAnalyticsClient.tsx`, shown only on the 8 filterable tabs (not "Overview", a fixed month-over-month snapshot with no filter param at all, and not "Team Activity", whose per-user table already breaks everyone out individually). The dropdown's options come from `data.perUser`, which is itself always team-wide regardless of the owner filter — confirmed this doesn't shrink to one row after picking someone.

**Deliberately not built in this pass: `leadSourceIds`/`customerProfileIds`/`stageIds`/`outcomes`.** Unlike `ownerIds`, these would be new filtering logic in 8 differently-shaped queries (e.g. "filter by lead source" means something structurally different in `sources.ts`, which already groups BY source, than in `geography.ts`, which doesn't touch source at all) — a real feature build with per-screen design judgment calls, not a wire-up of already-written code. Logged precisely in docs/DATA_GAPS.md rather than half-building it under this pass's momentum.

Verified with 7 direct assertions against production, calling the analytics functions directly (read-only, no test rows needed): scoping to the team's top-volume owner returns exactly that owner's real deal count (not an approximation) in both `geography()` and `funnelSnapshot()`, every `timelineMetrics()` stuck-deal returned actually belongs to the scoped owner, and a nonexistent ownerId correctly returns empty rather than silently falling back to team-wide data.

---

## 2026-07-16 — Tier 1/2 improvement batch: classification capture, editable Deal detail, structured loss reasons, firstContactAt

Fourth user-requested pass, working from a self-generated Tier 1-4 improvement list (asked for explicitly: "list that" before any fix). User approved all tiers except one explicit exclusion (below) and two explicit resolutions folded in from the same message.

**Tier 1 — lead source / customer profile / business type were captured nowhere.** `Deal.leadSourceId`, `Account.customerProfileId`, `Account.businessType` have existed on the schema since Phase 1, but no UI anywhere ever set them outside the `/deals` "New deal" form — every quote and court design created through the actual day-to-day workflow left them null, so Team Performance's Sources and Customers views were structurally empty for the app's main entry points. Extended `findOrCreateDealForConversation()`/`resolveAccountId()` (`src/lib/crm/deals.ts`) to accept and persist all three, added matching Step-1 fields to both `QuoteWizard.tsx` and `CourtImageWizard.tsx` (fetching `lead-sources`/`customer-profiles` from the existing open taxonomy GET endpoints), and wired `POST /api/quotations` / `POST /api/court-images` to pass them through. Classification is a correction, not a fill-once: re-resolving an existing account with new values overwrites (same rule already established for `siteCity`), so a later, better-informed quote can fix an earlier guess. Also fixed `DealsClient.tsx`'s `NewDealModal`, which collected `customerProfileId` but had no `businessType` field at all despite the API already accepting it (`z.enum(["B2B","B2C","B2G"])` in `POST /api/deals`) — tightened the two new wizard schemas to the same enum instead of a free string.

**Tier 1 — `FunnelStage.slaHours`/`probabilityPercent` were DB-only.** Both fields drive real analytics (`slaHours` → stuck-deal detection in `src/lib/analytics/timelines.ts`, falling back to a hardcoded 72h default; `probabilityPercent` → weighted pipeline value in `src/lib/analytics/forecast.ts`, which without it renders every stage unweighted) but had no admin UI — `PATCH /api/admin/taxonomy/[type]/[id]` already validated and accepted both, nothing ever called it with these fields. Added two columns to `TaxonomyClient.tsx`'s Funnel Stages tab. Number inputs commit on blur/Enter rather than per-keystroke, because `patchRow` triggers a full list reload (the table unmounts behind a "Loading…" placeholder while `loading` is true) — a per-character `onChange` commit would have dropped input focus after every digit.

**Tier 2 — Deal Detail page was entirely read-only.** `siteCityTierId`, `siteState`, `siteAddress`, `officeId`, `primaryContactId`, `expectedCloseAt` all had working backend support (`PATCH /api/deals/[id]` already validated all six) but no form. Added an "Edit details" modal to `DealDetailClient.tsx`; `page.tsx` now also fetches `Office`/`CityTier` lists server-side to populate the two new selects.

**Tier 2 — loss reason was free-text only in both closeout modals.** `LossReason` taxonomy + `Deal.lossReasonId` existed since Phase 1 and `transitionDeal()` already accepted `lossReasonId`, but `DealsClient.tsx`'s closeout modal only ever sent `lossReasonNote`, and `/pipeline`'s `CloseoutModal` had no concept of a structured reason at all — its underlying route, `POST /api/conversations/[id]/stage`, didn't even accept `lossReasonId` in its Zod schema. Added it there, threaded through `syncDealFromPipelineStageChange()`'s params to `transitionDeal()`, and added a reason dropdown to both modals (alongside the existing free-text note, not replacing it — a picked reason alone now satisfies "needs a reason," matching `transitionDeal()`'s own guard, which already accepted either).

**Tier 2 — `Deal.firstContactAt` was never set.** Feeds `timelineMetrics()`'s "response time" stat (enquiry → first contact) in `src/lib/analytics/timelines.ts` — permanently empty since nothing wrote it. Added the same set-once-on-entering-this-exact-stage pattern already used for `siteVisitAt`/`sampleSentAt`/`firstQuotedAt`/`negotiationAt`: fires on entering `contacted_qualified`, never overwritten on a later re-entry.

**Declined, not deferred:** the Tier 3 "manager vs. sales differentiated permissions" item (docs/DATA_GAPS.md #18) — explicit user instruction: *"Leave the Tier 3 9th option no need for manager."* Not revisited; `manager`/`management` stay functionally identical to `sales` going forward, by decision rather than by gap.

**Resolved, not deferred:** the rate-sheet admin-vs-sales conflict flagged in the Phase 6 RBAC entry below (docs/DATA_GAPS.md #19) — explicit user instruction: *"Rate sheet - the quatation rate sheet only change by admin fix this."* `PUT /api/quotations/rates` and `/settings/quotation-rates` are now admin-gated (403 / redirect for anyone else); `GET` stays open so sales can still view current rates while quoting.

**Incidental bug found and fixed while re-verifying `/pipeline`:** `src/app/(dashboard)/pipeline/page.tsx`'s fallback for an unrecognized `Conversation.pipelineStage` value was still the stale literal `"new"` — a real stage id under the old 7-stage vocabulary, but not a real `FunnelStage` slug since the unification below renamed it to `enquiry_received`. Any conversation that ever hit this fallback would have matched no column on the board and silently vanished from view rather than degrading visibly. Changed to `stages[0]?.id` (the lowest-sortOrder active stage), mirroring `PipelineClient.tsx`'s already-correct client-side `fallbackStageId`.

All of the above verified with 21 direct assertions against production (`__TEST__`-prefixed rows, cleaned up immediately after) rather than trusting typecheck alone — including that re-resolving an existing account overwrites rather than duplicates, that `firstContactAt` is genuinely set-once across a simulated re-entry, and that the taxonomy SLA/probability round-trip correctly restores the real stage's original values afterward (a live row was touched to prove the write path, then put back).

---

## 2026-07-16 — Pipeline/Team Performance stage vocabulary unification

Third user-requested clarification, working from a screenshot of the live Funnel tab: does `/pipeline`'s board actually use the same 13 stages Team Performance reports on? It didn't. `/pipeline` read stages from `DEFAULT_STAGES`, a hardcoded 7-value array in `src/lib/pipeline.ts` (new/qualified/demo_scheduled/proposal_sent/negotiation/won/lost) — a completely separate vocabulary from the real 13-row `FunnelStage` taxonomy Team Performance's Funnel/Sales-Activity/Forecast views all read. The two systems were bridged only through `transitionDeal.ts`'s `LEGACY_STAGE_MAP`/`REVERSE_LEGACY_STAGE_SLUG`, an inherently lossy many-to-one approximation (13 real stages compressed into 7 board columns and back) built during the "post-launch alignment pass" below as a stopgap, not a fix.

**Fixed at the root instead of patching the bridge further.** `getPipelineStages()` (`src/lib/pipeline-server.ts`) now reads `FunnelStage` directly — same 13 rows, same slugs, same colors, both systems share one vocabulary. This made the translation bridge unnecessary rather than merely simpler: deleted `LEGACY_STAGE_MAP`/`REVERSE_LEGACY_STAGE_SLUG` entirely, and `transitionDeal.ts`'s write-through (Deal → Conversation.pipelineStage) and sync-back (`syncDealFromPipelineStageChange`, renamed from `...LegacyStageChange`) are now direct same-slug operations, not lookups through an approximation. Also deleted `src/app/api/pipeline/stages/route.ts` — its entire purpose (admin-editable stage config) is now served by the Taxonomies admin page (Phase 1) reading/writing `FunnelStage` directly; confirmed zero UI callers before removing.

**One-time backfill, not a live migration.** Existing `Conversation.pipelineStage` values still held the old 7-slug vocabulary. `scripts/backfill-pipeline-stage-vocabulary.ts` (idempotent, kept) remapped each to the closest new slug using the same earliest-candidate reasoning the now-deleted reverse map used. Ran against production: 14 conversations migrated (12× `new`→`enquiry_received`, 1× `qualified`→`contacted_qualified`, 1× `proposal_sent`→`quotation_sent`). Re-ran to confirm idempotency — 0 changes.

**Rate-sheet access, resolved by explicit instruction** (folded into the same message as the pipeline question): `PUT /api/quotations/rates` is now admin-only; `/settings/quotation-rates` redirects non-admins server-side; the `/tools` panel entry is flagged `adminOnly`. Closes docs/DATA_GAPS.md #19 — see the fuller resolution note in the entry above.

**Also added in the same pass:** a left-side "assigned to" roster panel on `/pipeline` (both sales and admin), listing everyone the current owner filter matches as one flat, always-visible drag source — the 13-column board makes finding a specific person by scanning columns slow. Required a `dragId` override on `DraggableCard` (`rosterDragId()`/`stripRosterPrefix()` helpers) since dnd-kit requires a unique id per draggable and the same card now renders in two places (roster + its stage column) within one `DndContext`. No new permission logic needed — `page.tsx` already scopes the underlying `cards` list server-side before the roster panel ever sees it.

All changes verified against production before being called done, including that the vocabulary backfill script is genuinely idempotent and that dragging a roster card still moves it through the same `moveCard()`/`transitionDeal()` path as the stage columns.

---

## 2026-07-16 — `Quotation.isPrimary` was never actually maintained

A user question about whether product tracking correctly reflects a quote changing or a deal closing led to checking `isPrimary` directly: confirmed 0 of 31 quotations in production had ever been `false` — including a deal with 13 revisions, all marked primary. Harmless for a deal with one quote, but `src/lib/analytics/products.ts`'s "won" tracking specifically filters on `isPrimary` (per spec §7.2: won volume = line items on the *primary* quotation of a won deal) to avoid counting every historical revision's line items once a deal closes — so any deal with revisions that later won would have over-counted every product that ever appeared on any earlier draft, including ones the customer explicitly dropped.

**Fixed going forward**: `POST /api/quotations` now demotes all existing quotations on a deal to `isPrimary: false` before creating the new one as primary — a new revision is definitionally the current version.

**Fixed historically**: `scripts/fix-quotation-isprimary.ts` (kept, idempotent) sets exactly one primary per deal (the most recently created quotation) across all existing data. Ran against production: 1 deal corrected (the 13-revision one), 12 rows demoted. Re-ran to confirm idempotency — 0 changes on the second pass.

Verified the full lifecycle end-to-end rather than trusting the fix in isolation: a deal with two revisions (rev 1 has Turf + Fencing, rev 2 drops Fencing and keeps only Turf) marked Won correctly shows Turf with 1 enquiry / 2 quoted (both revisions sent — revisions count separately per spec, this part was already correct) / 1 won, and Fencing with 1 enquiry / 1 quoted / **0 won** — confirming a dropped product no longer falsely counts as sold.

---

## 2026-07-16 — Second alignment pass: location capture, stage auto-advance, stage colors

Three more user-reported clarifications, each verified against the real code before fixing:

**Site location — didn't exist in either wizard, not just unwired.** Checked `QuoteWizard.tsx` and `CourtImageWizard.tsx` line by line: neither ever asked for a location at all (only a customer *name*), so Geography analytics reading "(unspecified)" for everything wasn't a wiring bug, it was a missing input. Added a "Site city" field to both wizards' Step 1, plus `POST /api/quotations`, `POST`/`PATCH /api/court-images`, all writing through to `Deal.siteCity` (never stored redundantly on `Quotation`/`CourtImage` themselves). Also gave `POST /api/deals` (the `/deals` "New Deal" form) a sensible default — it already collects the account's own city but had no separate site-city field, and for most deals created there the two coincide (a school building a court at its own address) — falls back to the account's city rather than shipping null when we have *something*. A later quote or design can still correct it if the real site differs, since the wizard fields always win when provided.

**Sending a quote or design never advanced the pipeline — confirmed and fixed.** `POST /api/quotations/[id]/send` and `POST /api/court-images/[id]/send` rendered the PDF, sent it over WhatsApp, flipped status to "sent" — and stopped. Neither ever called `transitionDeal()`, so real, completed work left the deal frozen at whatever stage it started on, on both the new Deal system and (via the existing write-through) the legacy `/pipeline` board. Added `advanceDealStageIfEarlier()` in `transitionDeal.ts`: forward-only (a resent revision after the deal reached Negotiation must not drag it back to Quotation Sent), best-effort (never undoes an already-successful send), and correctly interacts with `transitionDeal()`'s own existing "needs a real sent quotation" guard — verified this exact sequencing directly rather than assuming it. Quote send now advances to "Quotation Sent"; design send now advances to "Design Shared".

**Stage colors — 12 of 13 had none.** Checked the database directly: only "Enquiry Received" had a `colorHex` (a leftover default); the other 12 were seeded without one and have been null since Phase 1. `scripts/seed-taxonomies.ts` never assigned them. Added a full 13-color progression (neutral start → blues/cyans for engagement → teal/violet for mid-process → indigo/purple for the formal quote/proposal stages → amber/orange for late-stage heat → the real Fitoverse brand green/red for Won/Lost, a cooler distinct gray for "Dropped/Cold" so it doesn't read the same as an active rejection) and re-ran the idempotent seed script against production.

All three verified with direct assertions against production (18 total checks across the three fixes, all passing) before being called done.

---

## 2026-07-16 — Post-launch alignment pass: wiring the rest of the app into Deal

A user-requested audit ("is the pipeline / quote generation actually aligned with Team Performance?") found that the new `Deal`-based CRM layer had been built *alongside* the app's real day-to-day workflow, not wired into it. Confirmed against live production data before fixing anything: 14 conversations actively tracked in `/pipeline`, only 1 had any `Deal`; 15 `PipelineStageHistory` rows vs. 0 `DealStageHistory` rows; 18 deals total, 17 of them disconnected one-off duplicates from repeat quoting. Fixed all of it:

**New shared chokepoint — `findOrCreateDealForConversation()`** (`src/lib/crm/deals.ts`). Reuses an existing Deal for a conversation if one exists, otherwise creates one (same account-dedup rule as the backfill script). `conversationId` is nullable — a genuinely standalone action creates a fresh Deal with `conversationId: null` rather than a synthesized fake id (an early draft of this tried faking a conversationId for the "no conversation" case and would have violated the real FK constraint on `Deal.conversationId` — caught before shipping).

**Quotations** (`POST /api/quotations`) previously created a brand-new standalone Deal on *every* quote, unconditionally. Now reuses an existing Deal via `conversationId` first — a second/revised quote for the same customer lands on the same Deal instead of fragmenting. Also now keeps `Deal.quotedValue` current on every new quote (previously only set once, at Deal creation, so a revision's real value never reached Sources/Forecast).

**Court designs** (`POST /api/court-images`) never set `dealId` under any live code path before this — every design was permanently orphaned from Deal. Now resolved the same way as quotations.

**Reminders** (`POST /api/reminders`) — the Inbox reminder panel only ever sends `conversationId`, never `dealId`. Now resolves one server-side when missing, so reminders set the normal way (from a conversation) are Deal-linked with zero UI change required.

**`/pipeline` board** — the single biggest gap. Its stage-change route (`api/conversations/[id]/stage`) only ever wrote `Conversation.pipelineStage`; the Deal write-through in `transitionDeal()` only ever ran the other direction. Added `syncDealFromLegacyStageChange()` in `transitionDeal.ts`: a best-effort bridge that find-or-creates a Deal for the conversation and calls `transitionDeal()` on it, using a new `REVERSE_LEGACY_STAGE_SLUG` map. The forward map (`LEGACY_STAGE_MAP`) is many-to-one, so the reverse direction is inherently ambiguous — each old 7-stage slug resolves to the *earliest* (lowest sortOrder) new stage among its candidates, the most conservative read available without inventing detail the old system never captured. Never blocks or fails the legacy response — `/pipeline` must keep working exactly as it always has even if a sync attempt hits `transitionDeal()`'s own validation (e.g. "won" with no value on file yet); verified this exact case directly: the Deal still gets created, the stage correctly does NOT move, and the legacy Conversation-side response is unaffected.

**Dead code removed** — `src/app/api/conversations/[id]/deal/route.ts` had zero callers (confirmed by two independent searches); its entire field set was already a strict subset of what the `/stage` route persists in the same transaction. Deleted.

**Lead → Deal conversion — didn't exist at all.** No button, no API field, nothing ever wrote `Lead.convertedDealId`, which silently zeroed out `src/lib/analytics/sources.ts`'s lead-to-won tracing for every lead created after the one-time backfill. Added `POST /api/leads/[id]/convert` (distinct from the confusingly-named `PATCH /api/leads/[id]/route.ts`, which operates on the unrelated `BotLead` model) and a "Convert to deal" button on the General Leads tab. Chatbot-sourced leads are covered too, since they're already mirrored into a real `Lead` row on capture (see the Phase 1 entry below) — the General Leads tab shows all `Lead` rows regardless of origin.

All six fixes verified with 20 direct assertions against production (the Neon dev branch had expired — 1-day expiration set when it was created — so this pass tested safely against prod with `__TEST__`-prefixed rows, cleaned up immediately after, same pattern used throughout this build for anything the dev branch couldn't cover in time).

---

## 2026-07-15 — Phase 6: RBAC test matrix against spec §13 — findings, not silently fixed

Wrote `scripts/rbac-matrix-check.ts` to test every cell of the spec's §13 permission matrix against what's actually enforced. Result: `manager` and `management` were added to the role enum in Phase 0, but **no route anywhere in the app gives them any capability beyond what `sales` already has**, except the audit log built earlier today (`isManagerOrAbove`/`isManagementOrAbove` have exactly one real caller each: the audit-log route and its own declaration). Concretely, against every matrix row:

- **Others' leads/deals** (spec: MANAGER = CRUD own-office, MANAGEMENT = read-all): `GET`/`PATCH /api/deals[/[id]]` only branch on `isAdmin` — a MANAGER or MANAGEMENT user sees/edits exactly their own deals, same as SALES. No office-scoping exists at all (`Deal.officeId` is nullable and nothing populates it yet either).
- **Analytics — team/company** (spec: MANAGER = own office, MANAGEMENT = all): `/team` and its API are gated `role !== "admin"` — a MANAGER or MANAGEMENT user is blocked outright, same as SALES.
- **Reassign owner** / **Edit timeline markers** / **Change lead source post-creation** (spec: MANAGER+ only): none of these exist as distinct, gated actions. `ownerUserId` is just a regular field in `PATCH /api/deals/[id]`'s schema — the deal's OWNER (including a plain SALES rep) can already reassign it to anyone, which is *more* permissive than the matrix intends, not less. Timeline markers (`enquiryAt`, `siteVisitAt`, etc.) aren't editable via any endpoint today, by anyone.
- **Manage taxonomies** / **Manage users** / **View audit log**: correctly admin-only / management+ — these pass.
- **Manage rates/products** — a real conflict, not a gap: `PUT /api/quotations/rates`'s own header comment says *"Both admin and sales can edit per the product spec (‘editable by admin and sales also’)"* — a deliberate, pre-existing product decision, predating this CRM build. The new spec's matrix says rates should be ADMIN-only. **Not changed** — silently locking sales out of rate editing could break a workflow Fitoverse relies on (e.g. adjusting a rate live during a customer conversation) without their sign-off. Flagging for a decision rather than guessing which spec wins. `/api/products/*` (the actual Product catalogue, distinct from the rate sheet) IS already admin-only and matches the matrix correctly.

**Net effect: promoting a user to `manager` or `management` in `/users` today does almost nothing** — they get the same access as `sales`. Closing this properly (office-scoping, a real reassign-owner action, role-aware `/team` access) is a real feature build, not a hardening pass — flagged here rather than attempted piecemeal under Phase 6's time budget. See `docs/DATA_GAPS.md` #18.

## 2026-07-15 — Phase 5: WhatsApp bot commands

`User.phone` didn't exist — the spec's §10 assumed it ("identify the sender by `User.phone`") but no Phase 0-4 work added it. Added it nullable/unique, plus a self-service field on `/profile` (not an admin-set field on `/users` — a rep's bot-command number is inherently their own, and the admin `/api/users/[id]` route already blocks self-edits by design) so a rep opts in themselves rather than someone setting it for them.

**Confirm-before-write, one mechanism for both commands that need it.** `remind` and `stage` both require echoing back the parsed result before saving (spec explicit for `remind`; "with a confirm step" for `stage`). Added one small table, `PendingStaffAction` (one row per user, 10-minute expiry), rather than overloading the existing `ConversationFlow` model — that model's `path`/`currentStep` vocabulary is specific to the customer-facing product-enquiry flow, and force-fitting a "staff command" case into it would blur what that model means. A non-yes/no message while a confirmation is pending abandons it and processes the new command fresh, rather than leaving the user stuck (spec: "keep it small and forgiving").

**Command parsing is fully hand-rolled** (`src/lib/chatbot/staffParse.ts`), not a date-parsing library — no such dependency existed in the project, and the spec's own "keep it small and forgiving" framing fit a compact parser (today/tomorrow/weekday/"in N hours"/bare-time/ISO-fallback) better than pulling in a new package for one command. Verified with 30 direct unit-test cases, including the trailing-garbage-rejection edge case a naive substring-match implementation would get wrong ("tomorrow 9am call the client" must NOT parse as a valid date on its own — every date pattern is fully `^...$`-anchored, not just prefix-matched).

**`executeStaffCommand` never calls `sendText` directly** — the actual outbound send lives only in `handleStaffMessage`, which lazy-imports `@/lib/whatsapp` and the chatbot dispatcher at call time rather than at module load. This was originally about testability (the pure command-execution logic needed to be unit-testable against the dev database without the test script transitively pulling in `axios` and risking a real Meta API call), but it's a defensible structural split on its own merits, not just a workaround.

**Deferred, not built:** `new lead`'s source is unattributed (`leadSourceId: null`) — the command syntax has no source field and nothing else here indicates one. `quote <code>` links to the deal page rather than a quotation-builder deep link with a prefilled deal — no such query-param integration exists in the wizard today and building one was out of scope for a chat command that explicitly shouldn't attempt full quoting over chat anyway.

## 2026-07-15 — Phase 4: product analytics group by line label, not catalogue Product

`src/lib/analytics/products.ts` (spec §7.3) was built to group by the matched catalogue `Product.name`, falling back to "(unspecified)". Testing against real backfilled data showed every one of 163 line items landed in "(unspecified)" — checked the actual stored labels ("Fencing", "Sub Base", "Artificial Turf for Multisports", "Nylon Net") against real `Product.name` values ("Football Turf 50mm B-HO", "Professional Sports Lighting System") and confirmed these are two different vocabularies, not a matching bug. Quote line items are generated from the rate-sheet cost categories (turf/fencing/lighting/sub-base/nets, always present, computed by sqft × rate); `productId` is a separate, optional field set only when a rep explicitly picks a specific catalogue SKU to illustrate one line — most quotes never do this. This isn't a historical-data-only gap; it's how the wizard works going forward too.

Fixed: group by `product?.name ?? label ?? "(unspecified)"` instead of requiring a Product match. `label` is the rate-sheet category name and is consistent across quotes, so grouping by it already answers the spec's own headline example ("football turf enquiries were higher and we also closed 4 football turf projects") without needing every line tied to a catalogue SKU. Verified: 24 real monthly rows across 12 categories with real rupee totals, vs. one meaningless "(unspecified)" bucket before the fix.

---

## 2026-07-15 — Phase 4: historical backfill (`scripts/backfill-crm.ts`)

Phase 1-2 shipped `Deal`/`Account`/`Lead` as new, empty tables — every quotation/conversation/design/bot-lead created before this build stayed unlinked, so the first Phase 4 analytics screens (sales-activity, funnel, geography, customers) read as entirely empty even though ~30 real quotations exist. Built the backfill script the original plan already called for but hadn't been run yet.

**Grouping rule, extended from the plan.** The plan said "one Deal per Conversation with quotes/designs" — but only 1 of 30 quotations actually has a `conversationId` (most quotes in this tool are created standalone, not threaded through a WhatsApp conversation). Extended the rule: conversation-grouped where a `conversationId` exists (all of that conversation's quotes/designs share one Deal), plus one Deal per conversation-less quotation/design otherwise. Idempotent either way — re-running looks up `dealId`/`leadId == null` and reuses an existing Deal for a conversation rather than duplicating it.

**Account de-dup: exact case-insensitive name match**, same rule the live "possible duplicate" check in `POST /api/deals` uses. Verified against real data: 18 backfilled deals correctly collapsed onto 12 accounts (e.g. "wr"/"WR" quotes merged onto one account). Known limitation: short/generic walk-in names ("e", "gh", "sf") could theoretically merge two different real customers who happen to share a name — accepted as a best-effort reconstruction, not verified lineage; fixable later by re-parenting a Deal to a different Account.

**Stage assignment from known signal only.** A deal lands in "Quotation Sent" if any of its linked quotations has `status: "sent"`, else "Enquiry Received" (the earliest stage). `outcome`/`closedAt` are left null on every backfilled deal — whether a historical quote became a won or lost project isn't recoverable from existing data and was not invented.

**Line items best-effort name-matched to `Product`.** Historical `Quotation.lineItems` JSON predates the `productId` field (dropped by the bug fixed in Phase 2), so line names are matched case-insensitively against `Product.name` where possible; unmatched items keep `productId: null` rather than guessing.

Tested on the `crm-dev` Neon branch first (30/30 quotations, 4/4 designs, 7/7 bot-leads linked; sales-activity and funnel screens confirmed showing real numbers, including 6 sent-revisions against 1 unique deal on the one conversation-linked record — the exact "revisions vs. unique deals" distinction the spec asked for). Then run against production — additive only (fills null FKs, creates new Account/Deal/Lead/DealLineItem rows), touches no existing row's existing data, safe to re-run.

---

## 2026-07-15 — Phase 0 reconciliation decisions

**Naming: `Contact` → `AccountContact`.** The spec's "person at an account" model collides with an existing, unrelated, actively-used `Contact` model (the broadcast/marketing contact list — phone, consent flag, tags). The new model is `AccountContact`.

**Migration tooling: baseline Prisma Migrate before any schema change.** This project has only ever used `prisma db push` — no `prisma/migrations/` history exists. Before any CRM schema work, migration history gets baselined (`prisma migrate diff --from-empty ... | prisma migrate resolve --applied`) so every subsequent change is a reviewable, named migration. All schema changes are tested against a Neon branch (not production directly) first.

**Money: `Decimal(12,2)` rupees, not paise integers.** Every existing money column in this schema is Decimal-rupees. New fields (`Deal.estimatedValue`/`quotedValue`/`wonValue`, `DealLineItem.rate`/`amount`, `Product.currentRate`) follow the same convention rather than introducing a second unit system. Same for GST: `Product.gstPercent Decimal(5,2)`, not `gstRateBp` basis points — matches the existing `RateSheetItem.gstPercent`/`QuoteLineItem.gstPercent` convention.

**User-reference FKs use the existing `...UserId` suffix**, not the spec's `...Id` — 8 existing precedents (`assignedToUserId`, `changedByUserId`, `ownerUserId`, etc.). `DealStageHistory.changedByUserId` is a structural match for the existing `PipelineStageHistory.changedByUserId`.

**Roles: widen, don't replace.** `User.role` stays a plain String; the Zod enum and shared `Role` type (`src/lib/rbac.ts`) widen from `"admin"|"sales"` to include `"manager"|"management"`. Public self-signup (`/api/auth/signup`) deliberately keeps its enum at 2 values — manager/management are granted only via the admin-controlled `/users` page.

**Pipeline → Deal: write-through, not replacement.** `Deal` becomes the new source of truth (Phase 1), but `transitionDeal()` writes through to `Conversation.pipelineStage`/`dealValue`/etc. whenever a Deal has a `conversationId`, so `/pipeline` and the current `/team` analytics keep working unchanged through Phase 1-2. The formal cutover of those pages to read `Deal` directly happens in Phase 4. `PipelineStageHistory` is not renamed/dropped — it stays serving the legacy view; new history goes to `DealStageHistory`.

**GST: `gstMode` column added, `"FLAT_18"` compute path deferred.** `Quotation.gstMode` defaults to `"SPLIT"` (today's itemized-bracket behavior — zero change). What a flat-18% quote should actually mean operationally is a real business/tax question, not something to guess at — left unimplemented until Fitoverse confirms.

**Taxonomy colors render via inline `style`/CSS custom properties**, never dynamically-built Tailwind class names — avoids the trap the existing `STAGE_COLOR_CLASSES` 7-token lockdown exists to work around (Tailwind's JIT purger can't see dynamic class names).

**`Quotation.lineItems` (JSON) and `DealLineItem` (relational) coexist.** The JSON snapshot stays the PDF-rendering source of truth; `DealLineItem` is a new, parallel, denormalized analytics projection with real `productId`/`sportId` FKs.

**Nullability: every new FK/column stays nullable, indefinitely.** Matches the codebase's own established pattern (visible on `Conversation`'s pipeline fields) — additive only, no later "tighten to NOT NULL" pass planned.

See `docs/DATA_GAPS.md` for the business inputs still needed from Fitoverse before certain features (value bands, city tiers, stage probabilities, etc.) are fully meaningful.
