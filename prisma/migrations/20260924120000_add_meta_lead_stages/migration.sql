-- CreateTable
CREATE TABLE "meta_lead_stages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "color_hex" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_lead_stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meta_lead_stages_name_key" ON "meta_lead_stages"("name");

-- CreateIndex
CREATE UNIQUE INDEX "meta_lead_stages_slug_key" ON "meta_lead_stages"("slug");

-- Seed the 6 default stages
INSERT INTO "meta_lead_stages" ("id", "name", "slug", "sort_order", "is_active", "color_hex", "is_default")
VALUES
  (gen_random_uuid(), 'New',           'NEW',           0, true, '#64748b', true),
  (gen_random_uuid(), 'Contacted',     'CONTACTED',     1, true, '#3b82f6', true),
  (gen_random_uuid(), 'Qualified',     'QUALIFIED',     2, true, '#f59e0b', true),
  (gen_random_uuid(), 'Converted',     'CONVERTED',     3, true, '#10b981', true),
  (gen_random_uuid(), 'Not Answered',  'NOT_ANSWERED',   4, true, '#8b5cf6', true),
  (gen_random_uuid(), 'Lost',          'LOST',          5, true, '#f43f5e', true);
