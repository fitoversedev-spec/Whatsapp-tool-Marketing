# CRM build — decisions log

Per the build spec's own rule (§0.5): when a spec requirement conflicts with something already built, the conflict is raised and reasoned through here rather than silently changed. Newest entries at the top.

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
