# AI Sales Agent → human handoff

Added on top of the existing agent API (`/api/agent/v1`). Nothing existing was
removed or renamed; a chat with no handoff behaves exactly as before.

## Flow

1. The customer asks to talk to a person.
2. The agent calls `POST /conversations/{id}/handoff` with `reason` and `summary`
   (the requirements gathered so far) and optionally `leadId`.
   Status: **PENDING**. Approvers get a push and see it under **CRM → AI handoffs**.
3. While PENDING the agent:
   - may send **one** holding reply ("I've asked our team to connect with you"),
   - then replies **only when the customer writes again**.
4. An approver picks a salesperson → **APPROVED**. The WhatsApp chat is assigned to
   them in the Inbox, the CRM customer moves to them (same path as any rep change),
   and they get a push. The AI is now silent in that chat.
5. Approver declines → **REJECTED**; the AI carries on as normal.
6. The salesperson (or an approver) clicks **Hand back to AI** → **RELEASED**; the AI carries on.

## Agent endpoints

| Tool | Route | Notes |
| --- | --- | --- |
| `request_human_handoff` | `POST /conversations/{id}/handoff` | Needs `Idempotency-Key`. Repeating while one is open returns it with `deduplicated: true`. |
| `get_ai_status` | `GET /conversations/{id}/ai-status` | `ai.mode`: `ai` / `waiting_for_human` / `human`; `ai.canReply`. Call before replying. |

The rule is enforced on the server too: `send_reply`, `send_template` and
`send_marketing_template` return **409** with code `waiting_for_customer` or
`human_assigned` when the AI must not speak. Treat both as "do not message".

## Agent prompt snippet

> If the customer asks to speak to a human, call `request_human_handoff` with the reason
> and a summary of their requirements, then tell them a team member will contact them.
> Before every reply call `get_ai_status`; if `canReply` is false, do not send anything.

## Database

New table `ai_human_handoffs` (migration `20261020120000_ai_human_handoff`), no
changes to existing tables. Apply with `npx prisma migrate deploy`.
