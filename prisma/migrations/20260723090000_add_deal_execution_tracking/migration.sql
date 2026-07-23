-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "delivery_completed_at" TIMESTAMP(3),
ADD COLUMN     "execution_started_at" TIMESTAMP(3),
ADD COLUMN     "execution_status" TEXT;

