-- Link a Reminder to a captured Meta ad lead, so the lead-detail sidebar's
-- Reminder control creates a real (rep-owned, cron-fired, badge + /reminders)
-- reminder. Additive only: 1 nullable column + index + FK on the existing
-- reminders table. Cascade-deletes the reminder if the lead is deleted.

-- AlterTable
ALTER TABLE "reminders" ADD COLUMN "meta_lead_id" TEXT;

-- CreateIndex
CREATE INDEX "reminders_meta_lead_id_idx" ON "reminders"("meta_lead_id");

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_meta_lead_id_fkey" FOREIGN KEY ("meta_lead_id") REFERENCES "meta_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
