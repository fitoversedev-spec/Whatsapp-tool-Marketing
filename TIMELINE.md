# WhatsApp Tool — 3-Day Planning

A focused plan to ship a production WhatsApp broadcast + inbox tool in three working days.

**Target launch:** End of Day 3 (Wed evening).
**Scope:** Broadcast from Google Sheet contacts, two-way inbox with 24-hour window, multi-user with admin + sales roles, template authoring with admin approval gate.

Legend: 👤 = owner (business side) · 🛠 = developer · ⏱ time block

---

## Day 1 — Mon — Foundation + service wiring

Goal: every backend integration proven end-to-end. No UI work yet; this day exists to surface integration surprises early.

| Time | Owner | Task |
|---|---|---|
| 09:00 – 10:00 | 🛠 | Scaffold Next.js 14 + TypeScript + Prisma + Tailwind. Define 7-table schema (users, templates, conversations, messages, broadcasts, broadcast_recipients, opt_outs). Initial migration. |
| 10:00 – 11:00 | 👤 | Gather Meta credentials (Phone Number ID, WABA ID, permanent Access Token with `whatsapp_business_messaging` + `whatsapp_business_management` scopes, App Secret, chosen Webhook Verify Token). |
| 10:00 – 11:00 | 👤 | Provision Neon Postgres project. Copy `DATABASE_URL`. |
| 10:00 – 11:00 | 👤 | Create Google Cloud project. Enable Sheets API. Create service account. Download JSON key. Share contact sheet with service-account email. |
| 11:00 – 13:00 | 🛠 | Build WhatsApp service wrapper (`sendTemplate`, `sendText`, `listTemplates`, `submitTemplate`). Phone normaliser. Google Sheets reader. |
| 14:00 – 16:00 | 🛠 | Build webhook receiver: HMAC verify, inbound message handler (auto-create conversation), status updater, STOP detection, template-status callbacks. |
| 16:00 – 17:00 | 🛠 | Build auth: bcrypt password hashing, iron-session cookie, login/logout/me routes, role-aware middleware (`requireUser`, `requireAdmin`). Seed script for first admin. |
| 17:00 – 18:00 | 🛠 + 👤 | Start ngrok tunnel, register webhook URL in Meta dashboard, subscribe to `messages` + `message_template_status_update`. Send a test template; reply STOP; verify both arrive in DB. |

**Day 1 exit criteria**
- Test template sent via curl → status updates arrive in DB
- Reply from a phone → conversation + message rows created
- "STOP" reply → row inserted into `opt_outs`
- Tampered webhook signature → request rejected with 401
- Admin login issues a session cookie

---

## Day 2 — Tue — UI + role-aware features

Goal: every page functional and wired to the Day 1 backend. End-to-end test through the UI before EOD.

| Time | Owner | Task |
|---|---|---|
| 09:00 – 10:00 | 🛠 | Login page + dashboard shell with role-aware sidebar (Users tab admin-only). Logout. |
| 10:00 – 12:00 | 🛠 | Inbox: conversation list (admin sees all; sales sees own + unassigned), thread view, reply composer with server-side 24-hour window check, auto-assign on first reply, 15-second polling. |
| 12:00 – 14:00 | 🛠 | Templates: list with status filter (draft / pending_admin / submitted / approved / rejected). Draft form. Sales "Submit for review" → admin "Submit to Meta". Status flow updates via webhook. |
| 14:00 – 16:00 | 🛠 | Broadcasts: composer (sheet URL, range, template, variable mapping). Sheet preview with will-send / opt-out / invalid counts. Throttled sender (paces sends, respects rate limits, skips opt-outs). Past-broadcasts table with role-filtered list and per-broadcast counters. |
| 16:00 – 17:00 | 🛠 | Users page (admin only): list, invite form, deactivate. |
| 17:00 – 18:00 | 👤 + 🛠 | End-to-end internal test: admin invites a sales user, sales drafts a template, admin promotes + submits to Meta, after approval sales launches broadcast to 5 internal numbers, verify replies flow into inbox, sales replies back, admin sees the same conversation. |

**Day 2 exit criteria**
- Sales user signs in, drafts a template, submits for review
- Admin promotes and submits to Meta; Meta-approval status reflects via webhook
- Sales launches a 5-contact broadcast and watches counters update
- Inbound replies arrive; reply composer enforces the 24-hour window
- Admin sees every conversation; sales sees only theirs + unassigned ones

---

## Day 3 — Wed — Deploy, soft test, production launch

Goal: live production URL, soft test passes its gates, real broadcast launched and monitored.

### Morning — Deploy (3h)

| Time | Owner | Task |
|---|---|---|
| 09:00 – 09:30 | 👤 | Push code to GitHub. |
| 09:30 – 10:30 | 🛠 | Vercel: link repo, set all production env vars, deploy. Verify HTTPS. |
| 10:30 – 11:00 | 👤 + 🛠 | Update webhook URL in Meta dashboard from ngrok to Vercel URL. Verify handshake. |
| 11:00 – 11:30 | 👤 | Smoke test: log in on production URL, send template to own number, see status arrive. |
| 11:30 – 12:00 | 👤 | Confirm current Meta messaging tier in WhatsApp Manager → Insights. Note daily cap (250 / 1K / 10K / 100K). |

### Midday — Soft test (3h)

| Time | Owner | Task |
|---|---|---|
| 12:00 – 12:30 | 👤 | Prepare a sheet of 20–50 opted-in internal contacts. |
| 12:30 – 13:00 | 👤 | Launch the soft-test broadcast through the production UI. |
| 13:00 – 15:00 | 👤 + 🛠 | Monitor delivery counters, inbox replies, opt-out detection, quality rating. |

**Soft-test gates** (all must pass before production launch)
- ≥95% delivered within 30 minutes
- Zero rate-limit errors
- Zero duplicate sends
- All STOP replies detected
- No critical UI / data bugs

### Afternoon — Go / no-go + launch (2h)

| Time | Owner | Task |
|---|---|---|
| 15:00 – 15:30 | 👤 + 🛠 | Go / no-go decision. If tier 1 (250/24h) and list exceeds the cap, chunk across days or upgrade. |
| 15:30 – 17:00 | 👤 | Launch the real broadcast. Watch first 100 sends live. Pause if failure rate > 5%. |
| 17:00 – 19:00 | 👤 + 🛠 | Monitor counters, opt-outs (surge > 2% indicates a content / targeting problem), quality rating dashboard. |

### Evening — Observation

| Time | Owner | Task |
|---|---|---|
| Post-launch | 👤 | Re-check quality rating after 4h, again next morning. Document any anomalies. |

---

## Day 4 onwards — Monitoring + V2 backlog

| Day | Activity |
|---|---|
| Thu | Quality-rating re-check; sales team handles inbound replies through the inbox. Pause future broadcasts if rating drops. |
| Fri | Observe; collect feedback from sales team on UX rough edges. |
| Next Monday | Start V2 planning (scheduled broadcasts, segments, real-time updates, conversation reassignment UI, media attachments). |

---

## Roles & Hand-offs

| Role | Responsibility |
|---|---|
| 👤 Business owner | Meta credentials, Neon DB provisioning, Google service account setup, sheet preparation, soft-test contact list, production launch decision, quality-rating monitoring. |
| 👤 Sales team (2–3 people) | Draft templates, monitor inbox, reply to customer messages during business hours. |
| 🛠 Developer | All code, deployment, integration debugging, on-call during launch window. |

---

## Critical Path

The shortest chain of unbreakable dependencies. If any link slips by more than a few hours, the Day 3 launch slips.

```
Meta credentials gathered → backend wired against Meta → webhook reachable via HTTPS
   → 5-contact internal E2E → soft test passes → production launch
```

---

## Risk Register

| Risk | Probability | Mitigation |
|---|---|---|
| Tier-1 daily limit (250/24h) caps the launch volume | Medium | Confirm tier on Day 3 morning. Chunk over multiple days or request upgrade. |
| Quality rating drops to Yellow / Red after launch | Medium | Soft test first. Honour opt-outs from Day 1. Use approved, generic template copy. |
| Webhook HMAC verification fails on first wire-up | Medium | Tested explicitly in Day 1 evening, not deferred to Day 3. |
| Vercel function timeout on long broadcasts | Low–Medium | Sender chunks in batches of 50 with self-reinvocation; webhook updates continue independently. |
| Sheet contains malformed phone numbers | High | Preview shows per-row invalid count before launch; admin can fix and re-run. |
| Duplicate sends after crash / retry | Low | Unique constraint on (broadcast_id, phone_e164); sender resumes only `queued` rows. |
| Template paused by Meta mid-broadcast | Low | Keep a backup template approved as fallback. |
| Real Meta account differs from code assumptions | Medium | Wire on Day 1 evening to surface issues 48 hours before launch. |

---

## Prerequisites Checklist (must be ready before Day 1 09:00)

**Meta**
- [ ] WABA verified, phone number registered, display name approved
- [ ] At least one marketing template already approved (the first launch template)
- [ ] System User with permanent access token (both required scopes)
- [ ] App Secret, App ID accessible
- [ ] Verify token string chosen

**Database**
- [ ] Neon account created (sign-up takes 2 minutes)

**Google**
- [ ] Cloud project created
- [ ] Sheets API enabled
- [ ] Service account created with JSON key
- [ ] Contact sheet shared with service-account email

**Hosting**
- [ ] Vercel account created
- [ ] GitHub account ready for the repo

**Local tools**
- [ ] Node.js 20+ installed on developer machine
- [ ] Git, ngrok or cloudflared installed

**Business inputs**
- [ ] Contact sheet column layout confirmed (which column is phone, name, each variable)
- [ ] Phone format in the sheet confirmed (with / without country code, plus sign, spaces)
- [ ] First-launch contact list selected and reviewed
- [ ] 2–3 sales-team email addresses for user invitations
- [ ] 20–50 opted-in internal contacts for Day 3 soft test

---

## Decision Gates

| Moment | Decision | Criteria |
|---|---|---|
| End of Day 1 | Proceed to UI work tomorrow? | Backend integrations all pass exit criteria |
| End of Day 2 | Proceed to deploy tomorrow? | 5-contact E2E passes, no critical bugs |
| Day 3 11:30 | What tier are we on? | Determines chunking strategy |
| Day 3 15:00 | Go / no-go for production launch | Soft-test gates all green |
| Day 3 evening | Continue tomorrow or pause? | Failure rate, opt-out surge, quality rating |

---

## Communication Cadence

| When | Format | Audience |
|---|---|---|
| Daily 09:00 | 5-minute standup | Owner + developer |
| Daily 13:00 | Slack check-in (any blockers) | Owner + developer |
| Daily 18:00 | EOD status (what passed / what didn't) | Owner + sales team |
| Day 3 15:00 | Go / no-go meeting | Owner + developer |
| Day 3 launch | Live monitoring in shared channel | All hands |
