# WhatsApp Broadcast + Inbox Tool — 3-Day Build Overview

A consolidated reference for the compressed 3-day production build.
Replaces the original 8-week plan in `IMPLEMENTATION_PLAN.md` (which is kept for v2 reference).

> **Scope expanded on 2026-05-18:** Two-way inbox, multi-user with admin + sales roles, and template-creation-with-approval-flow added back into the 3-day scope. Build is now ~30 hours of focused work across 3 days.

---

## 1. What We're Building

A **single-business WhatsApp marketing tool** that lets a small team (one admin + multiple sales users) run outbound broadcast campaigns AND handle the inbound replies they generate. Contacts are sourced from a Google Sheet; templates are authored inside the tool and submitted to Meta for approval through an admin-gated workflow.

It is a focused Wati-style tool — not a full Wati clone. Automation flows, advanced analytics, multi-tenancy, and integrations are still out of scope.

### Core capabilities (in scope)

1. **Multi-user authentication** with two roles: `admin` and `sales`
2. **Template authoring with admin approval gate**: sales drafts a template → admin reviews → admin submits to Meta → Meta approves/rejects → status flows back via webhook
3. **Broadcasts**: read contacts from a Google Sheet, map sheet columns to template variables, preview, launch a throttled send
4. **Two-way inbox**: see inbound customer replies, respond within the 24-hour window, status indicators on outbound messages
5. **Shared-inbox conversation visibility**: admin sees all conversations, sales sees their own + unassigned ones available for pickup; replying to an unassigned conversation auto-assigns it to the replier
6. **Opt-out handling**: STOP replies are detected, recorded in `opt_outs`, and excluded from all future broadcasts
7. **Per-broadcast results dashboard**: sent / delivered / read / failed counts with drill-down to recipient-level outcomes

### Role permissions

| Capability | Admin | Sales |
|---|---|---|
| Log in | ✅ | ✅ |
| Add / remove users | ✅ | ❌ |
| Draft a template | ✅ | ✅ |
| Submit template to Meta for approval | ✅ | ❌ (sales submits as `pending_admin`; admin promotes to `submitted`) |
| Launch a broadcast | ✅ | ✅ (uses any approved template) |
| Reply in inbox | ✅ | ✅ (within their visible conversations) |
| View ALL conversations / broadcasts | ✅ | ❌ (sees own + unassigned only) |
| Pick up an unassigned inbound | ✅ | ✅ (auto-assigns on first reply) |

### Explicitly out of scope (still)

- Contact CRUD UI — Google Sheets is the source of truth
- Tags or saved segments — different sheets per campaign
- Schedule-for-later — every launch is "send now"
- Real-time WebSocket — inbox polls every 15 seconds
- Multi-tenancy
- Media attachments in outbound replies (text only for v1)
- Automation / chatbot flows

---

## 2. Why These Choices

The three day deadline is the dominant constraint and drives every decision below.

| Decision | Reason |
|---|---|
| Next.js full-stack instead of separate API + web apps | Halves the deployment surface and shares types between frontend and API routes |
| Managed Postgres (Neon / Supabase) instead of self-hosted | Removes a full day of infra work; instant production database |
| In-process throttled sender instead of Redis + BullMQ | A 1,000-recipient broadcast doesn't need a distributed queue; one Node process is enough |
| Google Sheets as contact source instead of CSV upload UI | Eliminates the contacts subsystem entirely; marketing team uses a tool they already know |
| No inbox | Halves the build; broadcast is the explicit MVP need |
| Single admin password | Auth is not the value of the product; one password is enough for day-1 production |
| Vercel / Railway deploy with auto-HTTPS | Free, instant, no certificate management; Meta webhooks require HTTPS |

---

## 3. System Architecture

```
+------------------+        +-------------------------------+
|  Admin browser   | <----> |   Next.js application         |
|  (marketing      |  HTTP  |   (UI pages + /api routes)    |
|   team)          |        |                               |
+------------------+        |   - Login                     |
                            |   - Templates page            |
                            |   - Broadcast composer        |
                            |   - Results dashboard         |
                            |   - /api/webhooks/whatsapp    |
                            |   - In-process sender         |
                            +---------------+---------------+
                                            |
                              +-------------+--------------+
                              |                            |
                              v                            v
                  +-----------------------+    +----------------------+
                  |   Postgres (Neon)     |    |   Meta WhatsApp      |
                  |                       |    |   Cloud API          |
                  |   - broadcasts        |    |   graph.facebook.com |
                  |   - broadcast_        |    |                      |
                  |     recipients        |    +----------+-----------+
                  |   - opt_outs          |               |
                  +-----------------------+               |
                                                          |
                                  +-----------------------+
                                  |   Webhook POSTs back to
                                  |   /api/webhooks/whatsapp
                                  v
                            (statuses + inbound STOP replies)


                  +-----------------------+
                  |   Google Sheets API   |   <-- read-only, called by
                  |   (service account)   |       /api/broadcasts/preview
                  +-----------------------+       and the in-process sender
```

Everything lives in one Next.js process. There is no separate API server, no queue, no real-time channel. The sender is a function invoked when a broadcast is launched; it iterates over the recipient rows, calls the Meta API at a paced rate, and writes outcome rows back to Postgres.

---

## 4. Technology Stack

| Layer | Choice | Version | Why |
|---|---|---|---|
| Framework | Next.js (App Router) | 14 | Full-stack, file-based routing, single deploy |
| Language | TypeScript | 5.x | Type safety with Prisma is non-negotiable |
| Database | Postgres (Neon free tier) | 16 | Managed, zero setup, generous free quota |
| ORM | Prisma | 5.x | Type-safe queries, easy migrations |
| Styling | Tailwind CSS | 3.x | Fast UI without component library overhead |
| UI primitives | shadcn/ui (selective) | latest | Drop-in form / table / dialog components |
| HTTP client | Axios | 1.x | Familiar Graph API ergonomics |
| Sheets client | googleapis | latest | Official Node client for Sheets API |
| Auth | Single env-var password + signed cookie | — | Three days. No NextAuth ceremony |
| Hosting | Vercel | — | Free, instant HTTPS, env-var management built in |
| Logging | Pino | — | Structured logs visible in Vercel dashboard |
| Local dev tunnel | ngrok or cloudflared | — | Expose webhook URL to Meta during Days 1–2 |

---

## 5. Data Model

Seven tables. Contacts are still not stored as a top-level entity — Google Sheets remains the source of truth for outbound, but inbound replies create lightweight `conversations` rows keyed by phone number.

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| email | text UNIQUE | |
| password_hash | text | bcrypt or argon2 |
| name | text | Display name |
| role | text | `admin` or `sales` |
| is_active | boolean | Soft-delete flag |
| created_at | timestamptz | |

Seeded on first boot with one admin user from env vars (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`).

### `templates`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| name | text | Lowercase snake_case, Meta requirement |
| language | text | e.g., `en`, `en_US`, `hi` |
| category | text | `MARKETING`, `UTILITY`, `AUTHENTICATION` |
| header | jsonb (nullable) | Optional header component |
| body | text | Body with `{{1}}`, `{{2}}` placeholders |
| footer | text (nullable) | Optional footer |
| buttons | jsonb (nullable) | Optional buttons |
| status | text | `draft` / `pending_admin` / `submitted` / `approved` / `rejected` / `paused` |
| meta_template_id | text (nullable) | Returned by Meta once submitted |
| rejection_reason | text (nullable) | If Meta rejects |
| drafted_by_user_id | uuid | FK -> users |
| approved_by_user_id | uuid (nullable) | FK -> users (admin who clicked Submit) |
| submitted_at | timestamptz (nullable) | When admin submitted to Meta |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Status flow: `draft` → `pending_admin` (sales submits for review) → `submitted` (admin clicks Submit to Meta) → `approved` / `rejected` (Meta decides, webhook updates).

### `conversations`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| contact_phone | text UNIQUE | E.164 normalised |
| contact_name | text (nullable) | Snapshot from inbound webhook or sheet |
| assigned_to_user_id | uuid (nullable) | FK -> users; auto-set on first reply by that user |
| origin_broadcast_id | uuid (nullable) | FK -> broadcasts; set if conversation started from a broadcast reply |
| status | text | `open` / `closed` |
| last_inbound_at | timestamptz (nullable) | Drives 24-hour window |
| last_outbound_at | timestamptz (nullable) | |
| unread_count | int | Reset to 0 when a user opens the thread |
| created_at | timestamptz | |

### `messages`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| conversation_id | uuid | FK -> conversations |
| direction | text | `inbound` / `outbound` |
| type | text | `text` / `template` / `image` / `document` |
| body | text (nullable) | |
| media_url | text (nullable) | Future use |
| wa_message_id | text | Unique key for idempotency |
| template_id | uuid (nullable) | FK -> templates if direction=outbound type=template |
| status | text | `queued` / `sent` / `delivered` / `read` / `failed` |
| error | text (nullable) | |
| sent_by_user_id | uuid (nullable) | Which user composed an outbound reply |
| created_at | timestamptz | |

### `broadcasts`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| name | text | Human label |
| sheet_id | text | Google Sheet ID parsed from URL |
| sheet_range | text | e.g., "Contacts!A2:D" |
| template_id | uuid | FK -> templates (must be `approved`) |
| variable_mapping | jsonb | `{"1": "col_B", "2": "col_C"}` |
| status | text | `draft` / `running` / `completed` / `failed` |
| total / sent / delivered / read / failed | int | Live counters |
| created_by_user_id | uuid | FK -> users; sales sees only own |
| created_at / launched_at / completed_at | timestamptz | |

### `broadcast_recipients`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| broadcast_id | uuid | FK -> broadcasts |
| phone_e164 | text | Normalised |
| name | text | Snapshot from sheet |
| variables | jsonb | Resolved values for this row |
| wa_message_id | text | Returned by Meta on send |
| status | text | `queued` / `sent` / `delivered` / `read` / `failed` |
| error_code / error_message | text (nullable) | |
| sent_at / delivered_at / read_at | timestamptz (nullable) | |
| UNIQUE (broadcast_id, phone_e164) | | Prevents duplicates |
| INDEX on wa_message_id | | Webhook lookup |

### `opt_outs`
| Column | Type | Notes |
|---|---|---|
| phone_e164 | text | PK |
| opted_out_at | timestamptz | |
| reason | text | `stop_reply` / `manual` |

---

## 6. End-to-End User Flow

What the marketing admin actually does, step by step.

1. **Open the tool** at the production URL, enter the admin password, land on the dashboard.
2. **Templates page** — click "Sync" to pull latest templates from Meta; see which are approved, paused, or rejected.
3. **New broadcast** — paste the Google Sheet URL, choose a tab and range (e.g., `Contacts!A2:D`), pick an approved template, map sheet columns to template variables.
4. **Preview** — tool reads the first 5 rows from the sheet, renders what the message will look like for each one, shows count of opted-out numbers that will be skipped, shows count of malformed phone numbers that will be rejected.
5. **Launch** — admin clicks the confirm dialog. The broadcast row is created with status `running` and the in-process sender starts iterating.
6. **Monitor** — admin watches the broadcast results page; counters tick up as messages are sent, and as webhook statuses arrive from Meta.
7. **Completion** — when every recipient is processed, broadcast moves to `completed`. Final delivery / read / failure counts are visible. Failed rows are listed with reasons.
8. **Customer replies STOP** — webhook fires, opt_outs row inserted, that number excluded from all future broadcasts automatically.

---

## 7. System Flow (Technical)

### Sending a broadcast

```
Admin clicks Launch
   |
   v
POST /api/broadcasts/:id/launch
   |
   +-- mark broadcast.status = 'running'
   +-- read rows from Google Sheets (via service account)
   +-- normalise phone numbers to E.164
   +-- filter out opt_outs.phone_e164
   +-- insert broadcast_recipients rows (status='queued')
   +-- kick off in-process sender (async, returns 200 to admin)
   |
   v
In-process sender loop
   |
   for each recipient:
     +-- wait for rate-limit token (e.g., 10/sec)
     +-- POST /v21.0/{PHONE_NUMBER_ID}/messages with template + vars
     +-- on 200: update row status='sent', store wa_message_id
     +-- on error: update row status='failed' with code + message
   |
   v
When loop ends -> broadcast.status = 'completed', completed_at = now()
```

### Receiving webhook updates

```
Meta -> POST /api/webhooks/whatsapp
   |
   +-- verify X-Hub-Signature-256 HMAC using META_APP_SECRET
   +-- for each status in payload.statuses:
   |    +-- find broadcast_recipients by wa_message_id
   |    +-- update status + timestamp
   |    +-- recompute broadcast counters
   +-- for each message in payload.messages:
        +-- if body matches /^(stop|unsubscribe)$/i:
             +-- upsert opt_outs row
   |
   v
return 200 OK
```

### Webhook verification (GET)

```
Meta -> GET /api/webhooks/whatsapp?hub.verify_token=...&hub.challenge=...
   |
   if verify_token matches env var:
     +-- return plaintext hub.challenge
   else:
     +-- return 403
```

---

## 8. Day-by-Day Build Plan

Three intense days, ~10 hours of focused work each. No buffer.

### Day 1 — Foundation: DB, integrations, auth (10h)

Goal: every backend integration proven before any UI is built.

**Hours 1–2 — Scaffold**
- `npx create-next-app` with TypeScript + Tailwind
- Install Prisma, googleapis, axios, pino, zod, bcrypt, iron-session
- Create Neon database, paste `DATABASE_URL` into `.env`
- Define Prisma schema (7 tables in section 5), run first migration
- Seed admin user from `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD`

**Hours 3–5 — WhatsApp service**
- `services/whatsapp.ts`: `sendTemplate()`, `sendText()`, `listTemplates()`, `submitTemplate()`
- Test script: send hardcoded template to own number; confirm `wa_message_id` returned
- Test script: submit a tiny utility template; confirm Meta accepts the submission

**Hours 6–8 — Webhook receiver**
- `/api/webhooks/whatsapp` GET (verify challenge) + POST handlers
- HMAC verification middleware using `META_APP_SECRET`
- Branch logic on payload type:
  - `messages` array → upsert `conversations` row by phone, insert `messages` row, increment `unread_count`
  - `statuses` array → match `wa_message_id`, update `messages.status` AND `broadcast_recipients.status` if applicable, recompute broadcast counters
  - Template status updates (`message_template_status_update`) → update `templates.status`, `templates.rejection_reason` if any
- STOP detector on inbound text body → upsert `opt_outs`

**Hours 9–10 — Auth**
- `/api/auth/login` + `/api/auth/logout` + `/api/auth/me`
- iron-session cookie with `userId` + `role`
- `requireAuth()` and `requireAdmin()` middleware helpers
- ngrok tunnel running, webhook URL registered in Meta dashboard, all three webhook fields subscribed (`messages`, `message_template_status_update`)

**Day 1 done when:**
- curl test sends a template to your own number, status flows in via webhook
- Reply on phone arrives in DB as a `conversations` row + `messages` row
- Reply "STOP" inserts into `opt_outs`
- Tampered HMAC signature is rejected with 401
- Admin can `POST /api/auth/login` and get a session cookie

### Day 2 — All UI in one push (10h)

Goal: every page functional, role-aware, glued to Day 1 backend.

**Hours 1–2 — Login + shell**
- Login page (email + password form)
- Dashboard layout: sidebar with Inbox, Templates, Broadcasts, Users (Users only visible to admin)
- Top-right: logged-in user name + role + logout

**Hours 3–4 — Inbox** (highest user value, build first)
- Conversation list: role-filtered query (admin sees all; sales sees `assigned_to_user_id = me OR assigned_to_user_id IS NULL`)
- Unread badge per conversation
- Thread view: messages newest-at-bottom, status indicators on outbound, 24-hour window banner if expired
- Reply composer: textarea + Send; server-side guard rejects send if `last_inbound_at` > 24h ago
- Auto-assign: replying to an unassigned conversation sets `assigned_to_user_id` to the current user
- Polling: page refetches conversation list every 15 seconds

**Hours 5–6 — Templates**
- List page: filter by status (`draft`, `pending_admin`, `submitted`, `approved`, `rejected`)
- New template draft form (any user): name, category, language, body with placeholder helper, optional header / footer / buttons
- Save → status `draft`. Click "Submit for review" → status `pending_admin`
- Admin-only "Submit to Meta" button on `pending_admin` rows → calls `submitTemplate()`, sets status `submitted`, records `approved_by_user_id` + `submitted_at`
- Template status from Meta arrives via webhook, updates `status` and `rejection_reason`

**Hours 7–8 — Broadcasts**
- New Broadcast page: name, sheet URL input, range input, template dropdown (only `approved` shown), variable mapping dropdowns per `{{N}}` placeholder
- Preview panel: shows first 5 rendered messages, count of opted-out skips, count of malformed phone rejects
- Confirm dialog → launch handler
- Sender: async loop with `setTimeout`-based pacing (10/sec configurable), skips opt_outs, writes `broadcast_recipients` rows + outcome
- Past Broadcasts: role-filtered list with counters; detail view shows recipient table with status filter
- Long broadcasts: sender is invoked as a fire-and-forget async after responding 202 to admin; for Vercel timeout safety, sender processes in chunks of 50 and self-reinvokes via internal HTTP call

**Hours 9–10 — Users (admin only) + polish**
- Users list: email, name, role, active status
- "Invite user" form: email + name + role + temporary password
- Deactivate button (sets `is_active=false`; deactivated users cannot log in)
- Final smoke: 5-contact internal broadcast launched by sales user → all 5 messages arrive → one tester replies → reply appears in sales user's inbox → sales user replies back → message delivered

**Day 2 done when:**
- Sales user can log in, draft a template, submit for admin review
- Admin can promote the draft and submit it to Meta
- Once approved (via webhook), sales user can launch a broadcast using it
- Inbound replies appear in inbox; sales sees their broadcast's replies, admin sees everything
- Reply composer enforces 24-hour window
- Internal end-to-end run with 5 contacts succeeds

### Day 3 — Deploy, soft test, launch (10h)

**Hours 1–3 — Deploy**
- Push to GitHub; connect to Vercel
- Set all env vars (Meta credentials, DATABASE_URL, GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, SESSION_SECRET, SEED_ADMIN_*)
- Verify HTTPS
- Update webhook URL in Meta dashboard from ngrok → Vercel URL
- Confirm webhook handshake (verify_token GET returns challenge)
- Smoke: log in as seeded admin, send template to own number via deployed instance, confirm delivery + status flow

**Hours 4–6 — Soft test**
- Create test sheet with 20–50 internal opted-in numbers
- Sales user launches broadcast through deployed UI
- Watch counters every 10 minutes
- Required: ≥95% delivered within 30 minutes, no rate-limit errors
- One internal tester replies → sales user replies back through inbox → 24-hour window holds
- One internal tester replies STOP → next preview shows the skip

**Hours 7–8 — Tier check + bug fix**
- Confirm current Meta messaging tier in WhatsApp Manager → Insights
- If tier 1 (250/24h) and real list > 250 → decide: chunk across days, request upgrade, or accept partial
- Fix any bugs surfaced in soft test
- Final go / no-go

**Hours 9–10 — Production launch + monitor**
- Sales user (or admin) launches real broadcast
- Watch live counters; pause if failure rate > 5%
- Monitor `opt_outs` for surge (>2% = content / targeting problem)
- After completion: check quality rating, document any anomalies for v2

---

## 9. Testing Strategy

Three days does not allow a full automated test pyramid. The strategy is layered manual + targeted automated tests at the points where bugs cost the most.

### Layer 1 — Type safety (free)
TypeScript + Prisma catches a large class of bugs at compile time. Treat any `any` in the WhatsApp service or sheets client as a defect.

### Layer 2 — Unit tests on critical pure functions
Write Vitest unit tests only for the functions where a bug would corrupt data:
- `normalisePhone()` — must handle "+91 98765 43210", "919876543210", "9876543210", reject "abc"
- `mapVariables()` — must produce correct positional template parameter array
- `isOptOutMessage()` — must match "stop", "STOP", "stop please", but not "i would stop using…"
- `verifyHmac()` — must accept Meta's signature, reject tampered payloads

Aim for 30 minutes of test writing total. These four functions are where silent bugs become customer-visible.

### Layer 3 — Manual integration tests (Day 1 evening)
Checklist before moving to Day 2:
- [ ] Send template to own number via curl → arrives
- [ ] Webhook receives `sent` → `delivered` → `read` transitions on the message
- [ ] Reply on phone → `conversations` + `messages` rows appear
- [ ] Reply "STOP" → `opt_outs` row appears
- [ ] Tamper with HMAC signature → request rejected with 401
- [ ] GET webhook with wrong verify token → 403
- [ ] GET webhook with correct verify token → echoes challenge
- [ ] Submit a tiny test template via `submitTemplate()` → Meta returns template id, status `submitted`
- [ ] `POST /api/auth/login` with correct credentials → cookie issued; wrong password → 401

### Layer 4 — End-to-end test (Day 2 evening)
Multi-user, multi-feature flow:
- [ ] Admin logs in, invites a sales user
- [ ] Sales user logs in, drafts a template, submits for admin review
- [ ] Admin sees `pending_admin` template, clicks Submit to Meta → status `submitted`
- [ ] Once Meta approves (via webhook), sales user sees `approved` template available in broadcast composer
- [ ] Sales user launches broadcast to 5-contact internal sheet → all 5 arrive
- [ ] Counter UI updates as webhooks fire
- [ ] One tester replies → conversation appears in sales user's inbox (unassigned)
- [ ] Sales user replies through composer → auto-assigned, reply delivered, status updates
- [ ] Admin opens inbox → sees the same conversation
- [ ] Sales user opens inbox → sees own broadcast's replies + any unassigned spontaneous messages, NOT admin's other conversations
- [ ] One tester replies STOP → next broadcast preview shows the skip count incremented

### Layer 5 — Soft test (Day 3 midday)
20–50 opted-in internal numbers. Real production deployment.
Success thresholds:
- ≥95% delivered within 30 minutes
- Zero rate-limit errors
- Zero duplicate sends
- All STOP replies caught

### Layer 6 — Production launch monitoring (Day 3 evening)
- Watch counters live for the first 100 sends; pause if failure > 5%
- Watch quality rating in Meta dashboard for 24 hours after launch
- Watch opt_outs growth; surge above 2% indicates a content or targeting problem

### What we are NOT testing in 3 days
- Load (a 10K broadcast is out of scope; we may discover scaling issues only at that volume)
- Concurrent admin users (single-user assumption)
- Disaster recovery (no backup / restore drill)
- Browser compatibility beyond Chrome / Edge
- Accessibility audit

These belong in a v2 hardening pass.

---

## 10. Prerequisites — Everything Needed Before Day 1

### Already in place (confirmed)
- Meta Business Account verified
- WABA created
- Phone number registered, display name approved
- At least one marketing template approved
- Contacts in a Google Sheet with phone + name + 1–2 variable columns

### To gather before Day 1 morning

**Meta credentials** (Meta Business Settings + App Dashboard)
- `META_PHONE_NUMBER_ID`
- `META_WABA_ID`
- `META_ACCESS_TOKEN` (permanent, from System User with `whatsapp_business_messaging` + `whatsapp_business_management` scopes — second scope required for template submission)
- `META_APP_SECRET` (for webhook signature verification)
- `META_WEBHOOK_VERIFY_TOKEN` (any random string you choose)
- `META_GRAPH_API_VERSION` (use `v21.0`)

**Webhook subscriptions** (in Meta dashboard)
- `messages` — for inbound + statuses
- `message_template_status_update` — for template approval/rejection callbacks

**Database**
- Neon (or Supabase) account
- A new empty project
- `DATABASE_URL` connection string copied

**Google Sheets**
- Sheet URL of the contact list
- Confirmation of column layout: which column is phone, name, and 1-2 variables
- Confirmation of phone format: with or without country code? plus sign? spaces?

**Templates** (at least one already approved for Day 3 launch)
- Exact name as registered in Meta
- Language code (e.g., `en`, `en_US`, `hi`)
- Full body text with `{{1}}`, `{{2}}` placeholders
- Mapping decision: which sheet column maps to `{{1}}`, which to `{{2}}`

**Initial users**
- Seed admin email + password (env vars `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`)
- List of sales user emails + names to invite on Day 2

**Hosting**
- Vercel account (free tier sufficient)
- Optionally: a subdomain like `whatsapp.yourcompany.com`. Auto-generated Vercel URL works for day 1.

**Local tools (developer machine)**
- Node.js 20+
- pnpm or npm
- Git
- ngrok or cloudflared (for exposing webhook during Days 1–2)
- `SESSION_SECRET` — any 32+ random characters (for iron-session cookie encryption)

### To gather before Day 3 morning

- Current Meta messaging tier from WhatsApp Manager → Insights
- Final production sheet finalised and reviewed (no test data mixed in)
- Soft-test sheet of 20–50 opted-in internal numbers
- Communication plan for what to do if quality rating drops on Day 3

---

## 11. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tier-1 rate limit blocks the full launch | High if tier not checked | High | Check tier on Day 3 morning; chunk if needed |
| Quality rating drops to Yellow / Red after launch | Medium | Severe (weeks to recover) | Soft test first; honour opt-outs from Day 1; keep template generic |
| Webhook signature verification fails (wrong secret) | Medium | High (no statuses, no opt-outs) | Test on Day 1 evening before moving on |
| Google service account permissions missing | Medium | Medium | Test sheet read on Day 2 morning before building UI |
| Template gets paused by Meta mid-broadcast | Low | High | Have a fallback template approved as backup |
| Sheet has malformed phone numbers | High | Low | Validator rejects bad rows in preview; admin sees count |
| Duplicate sends after a crash / restart | Medium | High (quality + cost) | UNIQUE(broadcast_id, phone_e164); sender resumes only `queued` rows |
| Vercel function timeout during long broadcast | Medium for 1K+ | Medium | Sender runs in chunks; webhook updates continue independently |
| Admin password leaked | Low | High | Use a long random password; rotate after Day 3 |

---

## 12. Success Criteria — Definition of Done

**Day 1 done when:**
- All three tables exist in production DB
- Test template sent via API call to own number arrives within seconds
- Webhook captures sent / delivered / read transitions and writes to DB
- Replying STOP creates an opt_outs row
- Tampered webhook signature is rejected
- Admin can log in to the deployed instance

**Day 2 done when:**
- Sheet preview shows correct count of valid + invalid + opted-out rows
- Five-contact internal broadcast launched through the UI completes in under 60 seconds
- Counters in the results page match Meta's dashboard
- A STOP reply during the test is reflected in the next preview's skip count

**Day 3 done when:**
- Production URL is live and stable
- Soft-test broadcast (20–50 contacts) shows ≥95% delivered within 30 minutes
- Real production broadcast launched and monitored to completion
- Quality rating still Green 24 hours after launch
- One operational playbook page exists (where to look if things go wrong)

---

## 13. After Day 3 — V2 Roadmap (deferred work)

Items still deferred after the expanded 3-day build:

1. **Scheduled broadcasts** — pick a future time, sender wakes up on cron.
2. **Tags + segments inside the tool** — move beyond "one sheet per campaign".
3. **Redis + BullMQ** — once a single broadcast exceeds ~5K recipients or runs longer than Vercel function timeout.
4. **Real-time updates via Socket.io** — replace 15s polling.
5. **Media attachments in replies** — images, PDFs, audio in inbox replies.
6. **Conversation assignment UI** — explicit reassign / unassign buttons (currently auto-assigned on first reply).
7. **Analytics dashboard** — opens / clicks / conversions per broadcast over time.
8. **Automation / chatbot flows** — keyword auto-replies, simple decision trees.
9. **Backup + DR plan** — automated Postgres snapshots, restore drill.
10. **Audit log** — who did what, when (especially for template approvals and user management).

---

## 14. Immediate Next Step

Confirm you have all eleven items from section 10 ready, then say "go" and I will scaffold the Day 1 codebase.
