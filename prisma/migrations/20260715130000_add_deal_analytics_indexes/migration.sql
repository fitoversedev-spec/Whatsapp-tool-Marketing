-- CreateIndex
CREATE INDEX "deals_deleted_at_created_at_idx" ON "deals"("deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "deals_deleted_at_outcome_closed_at_idx" ON "deals"("deleted_at", "outcome", "closed_at");

