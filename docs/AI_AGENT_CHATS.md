# WhatsApp Marketing → AI agent chats

A page (`/ai-chats`, sidebar **AI agent chats**) listing every WhatsApp chat in
which the AI Sales Agent has sent at least one message, hot leads first.

- **Who sees what:** admin, manager and management see every AI chat; a salesperson sees the AI chats assigned to them
  **plus every unassigned HOT chat**, which they can take with **🙋 Take this lead**.

## Hot-lead alerts

The first time a chat is HOT, admins and managers (and the chat's rep, if any) get a push "🔥 Hot lead: <name>"
linking to this page. It is checked right after the AI replies, labels a chat or asks for a human, after a person
labels a chat, and in the cron sweep (`/api/cron/sweep`, `/api/cron/tick`). Each chat alerts once (`ai_hot_leads`).

## Taking a hot lead

Sales and managers can take an unassigned hot chat; the first click wins. The chat is assigned to them in the Inbox,
an unowned CRM customer goes to them, admins/managers get a push, and the AI goes quiet in that chat (an APPROVED
handoff — hand it back from CRM → AI handoffs). A chat whose customer is waiting for an admin to approve a
human handoff cannot be taken; the admin decides.
- **Per chat:** hot / warm / cold label and why, AI vs customer message counts, last activity, handoff status,
  requirements the AI captured (sport, budget, city, timeline, court size), the transcript inline, links to the Inbox and the CRM lead.
- **Changing a label:** admin, manager or the assigned salesperson can mark a chat hot / warm / cold, or set it back to automatic.

## How a chat gets its label (strongest first)

1. **Team** — set on the page by a person. The AI never overwrites it.
2. **AI agent** — the agent calls `set_lead_temperature` (`POST /api/agent/v1/conversations/{id}/temperature`, body `{ temperature, reason }`).
3. **Auto** — scored by `src/lib/ai-chats/scoring.ts`:

| Signal | Points |
| --- | --- |
| Asked to talk to a person | +40 |
| Budget / timeline / location / project details captured | +15 / +10 / +5 / +5 |
| Buying words from the customer (price, quote, site visit, call me, urgent, kitna…) | +20 |
| Cold words (not interested, too expensive, maybe later…) | −30 |
| 5+ / 2+ customer messages; no reply at all | +10 / +5; −10 |
| Customer replied in the last 24 h; quiet over a week | +10; −15 |
| Moved to CRM | +5 |
| Opted out | always cold |

Hot ≥ 60, warm ≥ 30, otherwise cold. Tune the words and points in that file.

## Agent prompt snippet

> After each customer reply, call `set_lead_temperature` with HOT (clear buying intent: budget or timeline confirmed,
> wants a quote, call or site visit), WARM (interested, undecided) or COLD (no interest), plus a one-line reason.

## Database

New table `ai_chat_insights` (migration `20261020150000_ai_chat_insights`); no existing table changes.
