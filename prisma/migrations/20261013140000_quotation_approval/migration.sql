-- Fitoverse AI Sales Agent, stage 4 (quotation tools): human sign-off on a quote
-- before the agent may send it, and a version chain for revisions. Purely
-- additive: five new columns on "quotations" (every existing row keeps working:
-- approval_state defaults to 'none', agent_origin to false) and one index.
-- Every statement is guarded so a re-run is harmless.

-- AlterTable
-- approval_state: none | pending | approved | rejected
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "approval_state" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "approved_by_user_id" TEXT;
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3);
-- The quote this one was revised from (agent revisions and approved discounts).
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "parent_quotation_id" TEXT;
-- True when the AI Sales Agent created the quote.
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "agent_origin" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "quotations_parent_quotation_id_idx" ON "quotations"("parent_quotation_id");
