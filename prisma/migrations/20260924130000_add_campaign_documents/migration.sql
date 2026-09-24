-- AlterTable
ALTER TABLE "insight_documents" ADD COLUMN "campaign_meta_id" TEXT;

-- CreateIndex
CREATE INDEX "insight_documents_campaign_meta_id_deleted_at_updated_at_idx"
ON "insight_documents"("campaign_meta_id", "deleted_at", "updated_at");
