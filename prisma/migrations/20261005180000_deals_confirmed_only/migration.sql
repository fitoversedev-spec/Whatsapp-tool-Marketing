-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "account_contact_id" TEXT;

-- AlterTable
ALTER TABLE "court_images" ADD COLUMN     "account_contact_id" TEXT;

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "expected_start_at" TIMESTAMP(3),
ADD COLUMN     "won_note" TEXT;

-- CreateTable
CREATE TABLE "contact_product_interests" (
    "id" TEXT NOT NULL,
    "account_contact_id" TEXT NOT NULL,
    "product_id" TEXT,
    "sport_id" TEXT,
    "label" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_product_interests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_product_interests_account_contact_id_idx" ON "contact_product_interests"("account_contact_id");

-- CreateIndex
CREATE INDEX "quotations_account_contact_id_idx" ON "quotations"("account_contact_id");

-- CreateIndex
CREATE INDEX "court_images_account_contact_id_idx" ON "court_images"("account_contact_id");

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_account_contact_id_fkey" FOREIGN KEY ("account_contact_id") REFERENCES "account_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_images" ADD CONSTRAINT "court_images_account_contact_id_fkey" FOREIGN KEY ("account_contact_id") REFERENCES "account_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_product_interests" ADD CONSTRAINT "contact_product_interests_account_contact_id_fkey" FOREIGN KEY ("account_contact_id") REFERENCES "account_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_product_interests" ADD CONSTRAINT "contact_product_interests_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_product_interests" ADD CONSTRAINT "contact_product_interests_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_product_interests" ADD CONSTRAINT "contact_product_interests_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Link existing quotations / court designs to their customer: the deal's
-- primary contact, or (quotations) the single live contact with that exact phone.
UPDATE "quotations" q SET "account_contact_id" = d."primary_contact_id"
FROM "deals" d
WHERE q."deal_id" = d."id" AND d."primary_contact_id" IS NOT NULL AND q."account_contact_id" IS NULL;

UPDATE "quotations" q SET "account_contact_id" = c."id"
FROM "account_contacts" c
WHERE q."account_contact_id" IS NULL AND q."contact_phone" IS NOT NULL
  AND c."phone" = q."contact_phone" AND c."deleted_at" IS NULL
  AND (SELECT count(*) FROM "account_contacts" c2 WHERE c2."phone" = q."contact_phone" AND c2."deleted_at" IS NULL) = 1;

UPDATE "court_images" ci SET "account_contact_id" = d."primary_contact_id"
FROM "deals" d
WHERE ci."deal_id" = d."id" AND d."primary_contact_id" IS NOT NULL AND ci."account_contact_id" IS NULL;

-- Product interest moves onto the contact (copied from enquiry-only deal lines).
INSERT INTO "contact_product_interests" ("id", "account_contact_id", "product_id", "sport_id", "label", "created_at")
SELECT gen_random_uuid(), d."primary_contact_id", li."product_id", li."sport_id", li."label", li."created_at"
FROM "deal_line_items" li
JOIN "deals" d ON d."id" = li."deal_id"
WHERE li."is_enquiry_only" = true AND d."primary_contact_id" IS NOT NULL AND d."deleted_at" IS NULL;
