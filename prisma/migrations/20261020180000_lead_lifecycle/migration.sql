-- Lead lifecycle: who asked for a handoff (customer / salesperson / admin),
-- when the AI introduced the salesperson, and the AI's first template to a
-- Meta lead-form lead. Purely additive; every statement is guarded.

ALTER TABLE "ai_human_handoffs" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'CUSTOMER_REQUEST';
ALTER TABLE "ai_human_handoffs" ADD COLUMN IF NOT EXISTS "requested_by_user_id" TEXT;
ALTER TABLE "ai_human_handoffs" ADD COLUMN IF NOT EXISTS "introduced_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ai_lead_outreach" (
    "id" TEXT NOT NULL,
    "meta_lead_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "template_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sending',
    "wa_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "ai_lead_outreach_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_lead_outreach_meta_lead_id_key" ON "ai_lead_outreach"("meta_lead_id");
CREATE INDEX IF NOT EXISTS "ai_lead_outreach_conversation_id_idx" ON "ai_lead_outreach"("conversation_id");
