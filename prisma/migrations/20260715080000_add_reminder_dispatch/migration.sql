-- AlterTable
ALTER TABLE "reminders" ADD COLUMN     "activity_type_id" TEXT,
ADD COLUMN     "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "deal_id" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "meeting_url" TEXT,
ADD COLUMN     "recurrence_rule" TEXT,
ADD COLUMN     "snoozed_until" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "reminder_dispatches" (
    "id" TEXT NOT NULL,
    "reminder_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider_message_id" TEXT,
    "error" TEXT,

    CONSTRAINT "reminder_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reminder_dispatches_reminder_id_channel_key" ON "reminder_dispatches"("reminder_id", "channel");

-- CreateIndex
CREATE INDEX "reminders_deal_id_idx" ON "reminders"("deal_id");

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_activity_type_id_fkey" FOREIGN KEY ("activity_type_id") REFERENCES "activity_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_dispatches" ADD CONSTRAINT "reminder_dispatches_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

