# AI lead process — end to end

How a lead travels from an ad or a WhatsApp message to a salesperson, with the
Hermes AI Sales Agent doing the first conversation.

## 1. Where leads come from

| Source | How it reaches us | First message |
| --- | --- | --- |
| **Instagram / Facebook lead ad** (instant form on a reel or post that runs as an ad) | Meta Page `leadgen` webhook → `MetaLead` within seconds | Must be a template: the AI sends the admin's **welcome template** (`start_lead_conversation`) |
| **Click-to-WhatsApp ad** or anyone messaging the business number | WhatsApp webhook → `Conversation` + `Message` | No template needed — the customer opened the 24 h window, the AI just replies |
| Organic post with no form / Instagram DMs | **Not connected** — this app only handles WhatsApp | Use a lead ad or a Click-to-WhatsApp ad instead |

## 2. What Hermes does (its loop)

1. Poll `GET /events` every few seconds (`types=message,lead`).
2. **New ad lead** (`type: lead, source: ad`) → `POST /ads/leads/{id}/conversation` → sends the welcome template once and returns the `conversationId`.
   `409 already_chatting` means the customer already messaged: reply in that `conversationId` instead.
3. **New customer message** → `GET /conversations/{id}/ai-status` → if `canReply`, read `get_messages` and reply with `send_reply`
   (follow `guidance` when a salesperson owns the lead).
4. Save what it learns: `PUT /leads/{id}/requirements`, notes, summaries; move good ad leads to the CRM (`move-to-crm`).
5. After each reply: `POST /conversations/{id}/temperature` (HOT / WARM / COLD + reason).
6. Customer asks for a person → `POST /conversations/{id}/handoff`.

Price, discount and commitment wording in any AI message is always held for a human (existing guard).

## 3. The team's side

- **WhatsApp Marketing → AI agent chats**: every AI chat, hot first, with transcript and captured requirements.
  - Admins/managers get a push the first time a chat turns hot.
  - **Admin**: *Assign* any chat to a salesperson directly, and choose the **welcome templates** (panel at the top).
  - **Salesperson**: sees their own AI leads plus unassigned hot ones, and can **Request this lead**.
- **CRM → AI handoffs**: every request waiting for an admin — the customer's own "talk to a person" and salespeople's requests.
  Approve & assign (the requester is pre-selected) or decline.

## 4. After a lead is assigned

- The WhatsApp chat is assigned to the salesperson and the CRM customer moves to them.
- The salesperson gets a **handover push**: name, number, needs, and a link to the full conversation.
- The AI tells the customer: *"Priya from the Fitoverse sales team will contact you from +91… I'm still here for any product or technical questions."*
  (Sent right away when the 24 h window is open; otherwise `get_ai_status.guidance` tells the AI to say it in its next reply.)
- The salesperson calls / WhatsApps the customer **from their own phone**.
- The AI **keeps answering** product and technical questions on the business number and leaves price, quotes, discounts and visits to the salesperson.
- **Every customer message and every AI reply** in that chat is pushed to the salesperson.
- Conversations on the salesperson's own phone are not recorded here — log calls and notes on the CRM lead.

## Settings and data

- Welcome templates: Setting `agent_welcome_templates` (edited on the AI agent chats page).
- Who approves: Setting `agent_approvers` (admins by default).
- Push notifications need web push configured in production.
- Tables: `ai_human_handoffs` (+ `kind`, `requested_by_user_id`, `introduced_at`), `ai_lead_outreach`, `ai_chat_insights`, `ai_hot_leads`.
