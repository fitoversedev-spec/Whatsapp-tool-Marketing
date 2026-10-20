-- Fitoverse AI Sales Agent: customer asks for a human -> admin approves and
-- assigns a salesperson. Purely additive: one new table, no existing table is
-- touched. Every statement is guarded so a re-run is harmless.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_human_handoffs" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "account_contact_id" TEXT,
    "identity_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "assigned_to_user_id" TEXT,
    "released_by_user_id" TEXT,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "ai_human_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_human_handoffs_conversation_id_status_idx" ON "ai_human_handoffs"("conversation_id", "status");
CREATE INDEX IF NOT EXISTS "ai_human_handoffs_status_requested_at_idx" ON "ai_human_handoffs"("status", "requested_at");
CREATE INDEX IF NOT EXISTS "ai_human_handoffs_assigned_to_user_id_status_idx" ON "ai_human_handoffs"("assigned_to_user_id", "status");
