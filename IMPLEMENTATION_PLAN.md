# WhatsApp Marketing Tool — Implementation Plan

A Wati-style internal tool for broadcast marketing + two-way customer chat, built on the **Meta WhatsApp Cloud API**.

---

## 1. Goals & Scope (MVP)

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Broadcast messaging** | Send approved template messages to a list/segment of contacts. Track delivery, read, replies. |
| 2 | **Two-way chat inbox** | Web UI where agents see incoming customer messages in real-time and reply within the 24-hour session window. |
| 3 | **Contact management** | Import contacts (CSV), tag/segment them, manage opt-in/opt-out. |
| 4 | **Template management** | Create, sync, and view approval status of WhatsApp message templates. |

**Out of scope (v1):** Chatbot flows, multi-tenancy, billing, CRM integrations, advanced analytics.

---

## 2. Pre-requisites (Business setup — do this FIRST)

These steps are blocking and take **3–7 days** of approval time. Start them before writing code.

1. **Meta Business Account** — https://business.facebook.com
2. **WhatsApp Business Account (WABA)** — created inside Meta Business Manager
3. **Phone number** — a dedicated number (not used on personal WhatsApp). Verify via SMS/call.
4. **Meta App** in developer console — add the "WhatsApp" product to it.
5. **System User + permanent access token** — required for production (temporary tokens expire in 24h).
6. **Display name approval** — Meta reviews your business display name (1–2 days).
7. **Webhook URL** — needs to be HTTPS, publicly reachable, with a verify token. Use **ngrok** for local dev.
8. **First message templates** — submit 2–3 templates for approval (e.g., `order_confirmation`, `promo_offer`).

**Cost note:** Free tier = 1,000 service conversations/month. Marketing conversations are billed per conversation (region-dependent, ~$0.01–$0.09 each in India).

---

## 3. Architecture

```
┌────────────────┐      ┌─────────────────────────────────────┐      ┌──────────────────┐
│  Agent / Admin │◄────►│   Next.js Frontend (React)          │      │                  │
│   (Browser)    │      │   - Inbox UI                        │      │                  │
└────────────────┘      │   - Broadcast composer              │      │                  │
                        │   - Contacts/Templates pages        │      │                  │
                        └──────────────┬──────────────────────┘      │                  │
                                       │ REST + WebSocket            │                  │
                                       ▼                             │   Meta           │
                        ┌──────────────────────────────────────┐     │   WhatsApp       │
                        │   Node.js Backend (Express/Fastify)  │     │   Cloud API      │
                        │   - REST API                         │◄───►│   graph.facebook │
                        │   - Socket.io (real-time inbox)      │     │   .com           │
                        │   - Webhook receiver                 │     │                  │
                        │   - Broadcast worker (BullMQ)        │     │                  │
                        └──────┬────────────────────┬──────────┘     └──────────────────┘
                               │                    │                         ▲
                               ▼                    ▼                         │
                        ┌────────────┐      ┌──────────────┐                  │
                        │ PostgreSQL │      │    Redis     │                  │
                        │ (data)     │      │ (queue+cache)│                  │
                        └────────────┘      └──────────────┘                  │
                                                                              │
                              Webhook events (incoming msgs, statuses)────────┘
```

**Why these choices:**
- **PostgreSQL** — relational data (contacts, messages, conversations) with JSONB for flexible payloads.
- **Redis + BullMQ** — broadcast send queue with retries, rate-limiting, and worker concurrency control. Critical because Meta rate-limits aggressively.
- **Socket.io** — push incoming messages to the inbox UI in real-time without polling.
- **Next.js** — single framework for frontend + can host BFF API routes; easy auth with NextAuth.

---

## 4. Tech Stack (concrete versions)

| Layer | Choice |
|-------|--------|
| Backend | Node.js 20 + TypeScript + Fastify (or Express) |
| Frontend | Next.js 14 (App Router) + React 18 + TypeScript |
| UI library | shadcn/ui + Tailwind CSS |
| Database | PostgreSQL 16 + Prisma ORM |
| Queue/Cache | Redis 7 + BullMQ |
| Real-time | Socket.io |
| Auth | NextAuth (email/password + role-based) |
| HTTP client | `axios` for Meta Graph API calls |
| File storage | Local disk (v1) → S3-compatible later (for media) |
| Process mgr | PM2 (single VM) or Docker Compose |
| Logging | Pino + log file rotation |
| Deployment | Single Linux VM (Hetzner/DigitalOcean/AWS EC2) for MVP |

---

## 5. Database Schema (key tables)

```sql
-- Users of the tool (your agents/admins)
users (id, email, password_hash, name, role, created_at)
   role: 'admin' | 'agent'

-- Customer contacts
contacts (id, phone_e164, name, opted_in, opted_out_at, tags[], custom_fields jsonb, created_at)
   UNIQUE(phone_e164)

-- Segments (saved filters / lists)
segments (id, name, filter_json, created_by, created_at)

-- WhatsApp message templates (synced from Meta)
templates (id, name, language, category, status, components jsonb, meta_template_id, updated_at)
   status: 'APPROVED' | 'PENDING' | 'REJECTED'

-- Conversations (one per contact)
conversations (id, contact_id, last_message_at, last_inbound_at, status, assigned_agent_id, unread_count)
   status: 'open' | 'closed'
   -- last_inbound_at drives the 24-hour customer service window

-- Individual messages (in + out)
messages (
  id, conversation_id, direction, type, body, media_url,
  wa_message_id, template_id, status, error,
  sent_by_user_id, created_at
)
   direction: 'inbound' | 'outbound'
   type: 'text' | 'template' | 'image' | 'document' | 'video' | 'audio'
   status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed'

-- Broadcast campaigns
broadcasts (
  id, name, template_id, segment_id, variables_map jsonb,
  scheduled_at, status, total_recipients, sent_count, delivered_count, read_count, failed_count,
  created_by, created_at
)
   status: 'draft' | 'scheduled' | 'running' | 'completed' | 'failed'

-- Per-recipient broadcast tracking
broadcast_recipients (id, broadcast_id, contact_id, message_id, status, error, sent_at)
```

---

## 6. REST API Endpoints

### Auth
- `POST /api/auth/login` — email/password → JWT/session
- `POST /api/auth/logout`
- `GET  /api/auth/me`

### Contacts
- `GET    /api/contacts?search=&tag=&page=` — paginated list
- `POST   /api/contacts` — create one
- `POST   /api/contacts/import` — CSV upload (multipart)
- `PATCH  /api/contacts/:id` — update name/tags/opt-out
- `DELETE /api/contacts/:id`

### Segments
- `GET  /api/segments`
- `POST /api/segments` — body: `{ name, filter: { tags: [...], opted_in: true } }`
- `GET  /api/segments/:id/contacts` — preview matches

### Templates
- `GET  /api/templates` — list (from local DB)
- `POST /api/templates/sync` — pulls latest from Meta Graph API
- `POST /api/templates` — create + submit to Meta for approval
- `GET  /api/templates/:id`

### Broadcasts
- `GET  /api/broadcasts`
- `POST /api/broadcasts` — create draft `{ name, template_id, segment_id, variables_map, scheduled_at? }`
- `POST /api/broadcasts/:id/launch` — enqueue jobs to send
- `GET  /api/broadcasts/:id` — includes per-recipient status counts
- `GET  /api/broadcasts/:id/recipients?status=failed`

### Conversations / Inbox
- `GET  /api/conversations?status=open&assignee=me`
- `GET  /api/conversations/:id/messages?before=&limit=50`
- `POST /api/conversations/:id/messages` — send reply `{ type, body, media_url? }`
- `PATCH /api/conversations/:id` — assign/close/reopen

### Webhook (called by Meta, not by frontend)
- `GET  /webhooks/whatsapp` — verification challenge (returns hub.challenge)
- `POST /webhooks/whatsapp` — incoming messages + status updates

### WebSocket events (Socket.io)
- `message:new` — push incoming message to inbox
- `message:status` — delivery/read receipts
- `conversation:updated` — assignment/unread changes

---

## 7. WhatsApp Cloud API — Critical Integration Details

### Sending a template message (broadcast)
```http
POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "to": "919876543210",
  "type": "template",
  "template": {
    "name": "promo_offer",
    "language": { "code": "en" },
    "components": [
      { "type": "body", "parameters": [
          { "type": "text", "text": "Rahul" },
          { "type": "text", "text": "20%" }
      ]}
    ]
  }
}
```

### Sending a free-form text (only within 24h of last inbound)
```http
POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages
{
  "messaging_product": "whatsapp",
  "to": "919876543210",
  "type": "text",
  "text": { "body": "Hi! How can I help?" }
}
```

### Webhook payload (incoming message)
Meta POSTs to your `/webhooks/whatsapp` endpoint:
```json
{
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "919876543210",
          "id": "wamid.XXXX",
          "timestamp": "1731500000",
          "type": "text",
          "text": { "body": "I have a question about my order" }
        }],
        "contacts": [{ "profile": { "name": "Rahul" }, "wa_id": "919876543210" }]
      }
    }]
  }]
}
```

### Webhook payload (status update)
```json
{
  "statuses": [{
    "id": "wamid.XXXX",
    "status": "delivered",   // sent | delivered | read | failed
    "timestamp": "1731500050",
    "recipient_id": "919876543210"
  }]
}
```

### **Critical rules to enforce in code**
1. **24-hour window**: Outside this window, only `type: template` messages are allowed. Check `conversation.last_inbound_at` before sending free-form text.
2. **Phone format**: Always E.164 without `+` (e.g., `919876543210`).
3. **Rate limits**: Start tier = 250 unique recipients/24h. Scales automatically based on quality rating. Throttle the broadcast queue accordingly.
4. **Webhook verification**: Must return `hub.challenge` plaintext on GET. Verify `X-Hub-Signature-256` HMAC on POST.
5. **Idempotency**: Use Meta's `wa_message_id` as a unique key — webhooks can be redelivered.
6. **Opt-out handling**: If a user replies "STOP" (or similar), set `contacts.opted_out_at` and exclude from future broadcasts. **Required for compliance.**

---

## 8. Project Folder Structure

```
whatsapp-tool/
├── apps/
│   ├── api/                        # Node.js backend
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── contacts.ts
│   │   │   │   ├── templates.ts
│   │   │   │   ├── broadcasts.ts
│   │   │   │   ├── conversations.ts
│   │   │   │   └── webhooks.ts
│   │   │   ├── services/
│   │   │   │   ├── whatsapp.ts     # Meta Graph API wrapper
│   │   │   │   ├── broadcast.ts    # Campaign orchestration
│   │   │   │   └── inbox.ts        # Conversation logic
│   │   │   ├── workers/
│   │   │   │   └── broadcastWorker.ts  # BullMQ consumer
│   │   │   ├── sockets/
│   │   │   │   └── io.ts           # Socket.io setup
│   │   │   ├── db/
│   │   │   │   ├── prisma.ts
│   │   │   │   └── schema.prisma
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts
│   │   │   │   └── webhookSignature.ts
│   │   │   └── server.ts
│   │   └── package.json
│   │
│   └── web/                        # Next.js frontend
│       ├── app/
│       │   ├── (auth)/login/
│       │   ├── (dashboard)/
│       │   │   ├── inbox/
│       │   │   ├── broadcasts/
│       │   │   ├── contacts/
│       │   │   ├── templates/
│       │   │   └── layout.tsx
│       │   └── api/                # Next.js API routes (BFF, optional)
│       ├── components/
│       │   ├── inbox/
│       │   ├── broadcasts/
│       │   └── ui/                 # shadcn components
│       ├── lib/
│       │   ├── api-client.ts
│       │   └── socket.ts
│       └── package.json
│
├── docker-compose.yml              # postgres + redis
├── .env.example
└── README.md
```

---

## 9. Implementation Phases (suggested order, ~6–8 weeks)

### Phase 0 — Setup (Week 1)
- [ ] Meta Business + WABA + phone number setup (in parallel with code)
- [ ] Submit 2–3 template messages for approval
- [ ] Repo scaffold, Docker Compose, Prisma migrations
- [ ] Auth (login, role-based middleware)

### Phase 1 — Send + Receive (Week 2)
- [ ] WhatsApp service wrapper (`services/whatsapp.ts`)
- [ ] Webhook receiver with signature verification
- [ ] Store incoming messages, create conversations
- [ ] Send a single text message via API (test happy path end-to-end)

### Phase 2 — Inbox UI (Week 3)
- [ ] Conversation list page + detail view
- [ ] Socket.io for real-time push
- [ ] Reply box with 24-hour window check
- [ ] Message status indicators (sent/delivered/read)

### Phase 3 — Contacts (Week 4)
- [ ] CSV import with validation (E.164 phone format)
- [ ] Tagging + custom fields
- [ ] Segments (saved filters)
- [ ] Opt-out detection on incoming "STOP"

### Phase 4 — Templates + Broadcasts (Weeks 5–6)
- [ ] Sync templates from Meta
- [ ] Broadcast composer (pick template, segment, variable mapping)
- [ ] BullMQ worker with rate-limited sends
- [ ] Per-recipient status tracking
- [ ] Broadcast dashboard (sent/delivered/read/failed counts)

### Phase 5 — Polish + Deploy (Weeks 7–8)
- [ ] Error handling, retry policies
- [ ] Logging + basic admin metrics
- [ ] Deploy to VM with HTTPS (Caddy/Nginx + Let's Encrypt)
- [ ] Switch webhook from ngrok to production URL in Meta dashboard
- [ ] Load test broadcast send with a 100-contact list

---

## 10. Environment Variables (.env.example)

```
# Server
PORT=4000
NODE_ENV=development
JWT_SECRET=changeme

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/whatsapp_tool
REDIS_URL=redis://localhost:6379

# Meta WhatsApp
META_GRAPH_API_VERSION=v21.0
META_PHONE_NUMBER_ID=
META_WABA_ID=
META_ACCESS_TOKEN=
META_WEBHOOK_VERIFY_TOKEN=  # any random string, also configured in Meta dashboard
META_APP_SECRET=             # for X-Hub-Signature-256 verification

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
```

---

## 11. Known Gotchas & Compliance

1. **Template approval is slow.** Submit early. Marketing templates get rejected most often — keep copy generic.
2. **24-hour service window** is enforced server-side by Meta — your code must respect it or sends will fail.
3. **Quality rating** drops if users mark you as spam. Once rating = "Red", Meta throttles you. Always honor opt-outs.
4. **Phone number cannot be reused** on personal WhatsApp once registered with Cloud API.
5. **Webhook must be HTTPS** with valid cert. For dev, use **ngrok** or **cloudflared**.
6. **Media files** expire on Meta's CDN in 30 days — download and re-host if you need long-term storage.
7. **India DLT registration** is not required for WhatsApp (unlike SMS) but check local regulations for your market.

---

## 12. Open Questions Before Coding Starts

1. Single phone number or do you anticipate multiple from day 1?
2. Expected broadcast size (100s / 1000s / 10,000s per send)?
3. Number of concurrent agents using the inbox?
4. Where will it be hosted? (Affects webhook URL, SSL cert setup)
5. Any specific CRM/ERP it should integrate with later (Shopify, Zoho, etc.)?
