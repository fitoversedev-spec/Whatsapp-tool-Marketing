-- AI agent chats page: hot / warm / cold classification of WhatsApp chats the
-- AI Sales Agent handled. Purely additive: one new table. Every statement is
-- guarded so a re-run is harmless.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_chat_insights" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "temperature" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "set_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_chat_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ai_chat_insights_conversation_id_key" ON "ai_chat_insights"("conversation_id");
CREATE INDEX IF NOT EXISTS "ai_chat_insights_temperature_idx" ON "ai_chat_insights"("temperature");

-- Hot-lead alerts and claims (one row per chat that turned hot).
CREATE TABLE IF NOT EXISTS "ai_hot_leads" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "first_hot_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMP(3),
    "claimed_by_user_id" TEXT,
    "claimed_at" TIMESTAMP(3),

    CONSTRAINT "ai_hot_leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_hot_leads_conversation_id_key" ON "ai_hot_leads"("conversation_id");
CREATE INDEX IF NOT EXISTS "ai_hot_leads_claimed_by_user_id_idx" ON "ai_hot_leads"("claimed_by_user_id");
