-- CreateTable
CREATE TABLE "excluded_places" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "google_place_id" VARCHAR(255) NOT NULL,
    "category_id" VARCHAR(100) NOT NULL,
    "scan_id" UUID NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "excluded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "excluded_places_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "excluded_places_owner_place_category_idx" ON "excluded_places"("owner_id", "google_place_id", "category_id");

-- CreateIndex
CREATE INDEX "excluded_places_owner_idx" ON "excluded_places"("owner_id");

-- CreateIndex
CREATE INDEX "excluded_places_scan_idx" ON "excluded_places"("scan_id");

-- AddForeignKey
ALTER TABLE "excluded_places" ADD CONSTRAINT "excluded_places_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "excluded_places" ADD CONSTRAINT "excluded_places_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
