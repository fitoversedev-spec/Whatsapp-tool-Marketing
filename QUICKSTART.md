# Quickstart — Wire It Up and Log In

The whole tool is built. To make it work, you need to plug in 3 things: a database, your Meta credentials, and a Google service account. Below is the exact sequence.

## 1. Create the database (Neon — 2 min)

1. Go to https://neon.tech and sign up (free tier is enough)
2. Create a new project → copy the connection string (looks like `postgresql://user:pass@host/db?sslmode=require`)

## 2. Set environment variables

Copy `.env.example` to `.env` and fill in the values you have:

```bash
cp .env.example .env
```

Then edit `.env`:

```env
# Required to log in
DATABASE_URL=postgresql://...                          # from Neon
SESSION_SECRET=any-random-32-char-string-please-replace
SEED_ADMIN_EMAIL=you@yourcompany.com
SEED_ADMIN_PASSWORD=changeMe123
SEED_ADMIN_NAME=Your Name

# Required to send WhatsApp messages
META_GRAPH_API_VERSION=v21.0
META_PHONE_NUMBER_ID=...           # Meta dashboard → WhatsApp → API Setup
META_WABA_ID=...                   # Business Settings → Accounts → WhatsApp Accounts
META_ACCESS_TOKEN=...              # System User → Generate Token (needs whatsapp_business_messaging + whatsapp_business_management scopes)
META_APP_SECRET=...                # App Dashboard → Settings → Basic → App Secret
META_WEBHOOK_VERIFY_TOKEN=...      # Any random string you choose; mirror it in Meta dashboard

# Required for Google Sheets contact source
GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=...   # See "Google Sheets setup" below
```

## 3. Create tables + seed admin

```powershell
npm run db:push       # creates the 7 tables in Neon
npm run seed          # creates your admin user
```

## 4. Start the dev server

```powershell
npm run dev
```

Open http://localhost:3000, log in with the admin email/password you set.

## 5. Expose webhook to Meta (during dev)

Meta needs an HTTPS URL to deliver inbound messages + status updates.

**Use ngrok** (free):
```powershell
ngrok http 3000
```

It prints a URL like `https://abc123.ngrok.io`. In the Meta dashboard:
1. WhatsApp → Configuration → Webhooks → Edit
2. Callback URL: `https://abc123.ngrok.io/api/webhooks/whatsapp`
3. Verify token: same string you put in `META_WEBHOOK_VERIFY_TOKEN`
4. Subscribe to fields: `messages`, `message_template_status_update`

Meta will hit your webhook to verify, then start sending events.

## 6. Google Sheets setup

1. Go to https://console.cloud.google.com
2. New project (or pick existing)
3. APIs & Services → enable **Google Sheets API**
4. IAM & Admin → Service Accounts → Create Service Account
5. Done → Keys → Add Key → JSON → downloads `your-project-xxx.json`
6. Base64-encode it and set the env var:

   On PowerShell:
   ```powershell
   $bytes = [IO.File]::ReadAllBytes("your-project-xxx.json")
   [Convert]::ToBase64String($bytes) | Set-Clipboard
   ```
   Paste the value into `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=` in `.env`.

7. Open your contact Google Sheet, click **Share**, paste the service account email (looks like `whatsapp-tool@your-project.iam.gserviceaccount.com`), give **Viewer** access.

## 7. First end-to-end test

1. Log in as admin
2. **Templates** → New template → write a draft → "Submit for review" → "Submit to Meta"
3. Wait for Meta to approve (webhook updates status automatically)
4. **Users** → Invite a sales user
5. Sales user logs in
6. **Broadcasts** → New broadcast → paste sheet URL → preview → launch to 1-2 test numbers
7. Reply on a test phone → conversation appears in **Inbox**
8. Reply through the inbox → confirms 24-hour window enforcement

## What's built

| Feature | Status |
|---|---|
| 7-table data model + Prisma migrations | ✅ |
| Multi-user auth (email/password, sessions) | ✅ |
| Role-based middleware (admin / sales) | ✅ |
| Inbox: role-filtered, 24h window guard, auto-assign, polling | ✅ |
| Templates: draft → pending_admin → submitted → approved flow | ✅ |
| Broadcasts: sheet read, preview, throttled send, per-recipient tracking | ✅ |
| Users: admin invite + deactivate | ✅ |
| Webhook receiver: signature verify, statuses, inbound, opt-out, template approval | ✅ |
| Throttled in-process sender with chunked progress | ✅ |
| WhatsApp service: send template, send text, submit template | ✅ |
| Google Sheets reader (service account) | ✅ |
| Seed script for first admin | ✅ |

## What still needs to happen on your side

1. Fill in `.env` (this guide)
2. `npm run db:push && npm run seed`
3. Wire up ngrok during dev OR deploy to Vercel for production
4. Submit your first marketing template via the UI and wait for Meta approval
5. Soft test with 20-50 internal numbers before the real broadcast

## Deploy to Vercel (Day 3)

```bash
# Push to GitHub first
gh repo create whatsapp-tool --private --source=. --push

# Then on Vercel
vercel link
vercel env add DATABASE_URL          # paste Neon URL
vercel env add SESSION_SECRET
vercel env add SEED_ADMIN_EMAIL
vercel env add SEED_ADMIN_PASSWORD
vercel env add SEED_ADMIN_NAME
vercel env add META_GRAPH_API_VERSION
vercel env add META_PHONE_NUMBER_ID
vercel env add META_WABA_ID
vercel env add META_ACCESS_TOKEN
vercel env add META_APP_SECRET
vercel env add META_WEBHOOK_VERIFY_TOKEN
vercel env add GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
vercel --prod
```

After deploy, update the webhook URL in Meta dashboard from your ngrok URL to `https://your-vercel-url.vercel.app/api/webhooks/whatsapp`.
