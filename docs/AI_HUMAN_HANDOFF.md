# AI Sales Agent → salesperson handoff

Part of the lead process described in [LEAD_PROCESS.md](LEAD_PROCESS.md). Added on
top of the existing agent API (`/api/agent/v1`); a chat with no handoff behaves
exactly as before.

## Ways a lead reaches a salesperson

| Kind | Started by | While waiting for the admin |
| --- | --- | --- |
| `CUSTOMER_REQUEST` | The customer asks the AI for a person → `request_human_handoff` | AI may send **one** holding reply, then only replies when the customer writes again |
| `SALES_REQUEST` | A salesperson clicks **Request this lead** on AI agent chats (hot, unassigned) | AI carries on normally |
| `ADMIN_ASSIGN` | An admin clicks **Assign** on AI agent chats | — (assigned at once) |

Requests wait on **CRM → AI handoffs**. Approve & assign → **APPROVED**; decline → **REJECTED** (AI carries on).

## After assignment (APPROVED)

- Chat assigned to the salesperson in the Inbox; the CRM customer moves to them; they get a handover push.
- The AI introduces them to the customer by name and phone (`User.phone`).
- The salesperson contacts the customer **from their own phone**; the AI keeps answering product and technical
  questions and leaves price, quotes, discounts and visits to them (`get_ai_status.guidance`).
- Every customer message and AI reply is pushed to the salesperson.
- **Release lead** (salesperson or admin) → **RELEASED**.

## Agent endpoints

| Tool | Route | Notes |
| --- | --- | --- |
| `request_human_handoff` | `POST /conversations/{id}/handoff` | Needs `Idempotency-Key`. Repeating while one is open returns it (`deduplicated: true`). |
| `get_ai_status` | `GET /conversations/{id}/ai-status` | `ai.mode`: `ai` / `waiting_for_human` / `sales_assigned`; `ai.canReply`; `guidance` when a salesperson owns the lead. |

The only refusal from the send tools is **409 `waiting_for_customer`** (a customer's own request is waiting and
the AI already spoke last).

## Database

Table `ai_human_handoffs` (migration `20261020120000_ai_human_handoff`, extended by `20261020180000_lead_lifecycle`).
