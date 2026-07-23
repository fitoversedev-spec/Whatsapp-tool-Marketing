-- CreateTable
CREATE TABLE "targets" (
    "id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT,
    "period_type" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "target_revenue" DECIMAL(12,2) NOT NULL,
    "target_deals" INTEGER,
    "set_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "targets_scope_type_scope_id_period_type_period_start_key" ON "targets"("scope_type", "scope_id", "period_type", "period_start");

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_set_by_user_id_fkey" FOREIGN KEY ("set_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
