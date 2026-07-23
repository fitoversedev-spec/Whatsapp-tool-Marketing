-- AlterTable
ALTER TABLE "account_contacts" ADD COLUMN     "pipeline_stage" TEXT;

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "next_action_due_at" TIMESTAMP(3),
ADD COLUMN     "next_action_note" TEXT;

-- AlterTable
ALTER TABLE "reminders" ADD COLUMN     "priority" TEXT;

