-- CreateTable
CREATE TABLE "value_bands" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "min_value" DECIMAL(12,2),
    "max_value" DECIMAL(12,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "value_bands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "value_bands_is_active_sort_order_idx" ON "value_bands"("is_active", "sort_order");

