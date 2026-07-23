-- AlterTable
ALTER TABLE "reminders" ADD COLUMN     "account_contact_id" TEXT;

-- CreateIndex
CREATE INDEX "reminders_account_contact_id_idx" ON "reminders"("account_contact_id");

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_account_contact_id_fkey" FOREIGN KEY ("account_contact_id") REFERENCES "account_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

