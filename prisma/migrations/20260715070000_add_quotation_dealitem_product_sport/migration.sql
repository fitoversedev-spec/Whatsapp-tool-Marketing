-- AlterTable
ALTER TABLE "court_images" ADD COLUMN     "deal_id" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "code" TEXT,
ADD COLUMN     "current_rate" DECIMAL(12,2),
ADD COLUMN     "default_unit" TEXT,
ADD COLUMN     "gst_percent" DECIMAL(5,2),
ADD COLUMN     "product_category_id" TEXT,
ADD COLUMN     "rate_is_confirmed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "accepted_at" TIMESTAMP(3),
ADD COLUMN     "deal_id" TEXT,
ADD COLUMN     "gst_mode" TEXT NOT NULL DEFAULT 'SPLIT',
ADD COLUMN     "is_primary" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rejected_at" TIMESTAMP(3),
ADD COLUMN     "sent_via" TEXT DEFAULT 'whatsapp',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "product_rate_history" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "set_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_rate_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "color_hex" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_rate_history_product_id_effective_from_idx" ON "product_rate_history"("product_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_slug_key" ON "product_categories"("slug");

-- CreateIndex
CREATE INDEX "product_categories_is_active_sort_order_idx" ON "product_categories"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "quotations_deal_id_version_idx" ON "quotations"("deal_id", "version");

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_images" ADD CONSTRAINT "court_images_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_product_category_id_fkey" FOREIGN KEY ("product_category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_rate_history" ADD CONSTRAINT "product_rate_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

