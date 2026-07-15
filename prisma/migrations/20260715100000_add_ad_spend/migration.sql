-- CreateTable
CREATE TABLE "ad_spend" (
    "id" TEXT NOT NULL,
    "lead_source_id" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "set_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_spend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ad_spend_lead_source_id_month_key" ON "ad_spend"("lead_source_id", "month");

-- AddForeignKey
ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_lead_source_id_fkey" FOREIGN KEY ("lead_source_id") REFERENCES "lead_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

