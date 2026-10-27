-- Website leads: "Build a court" enquiries POSTed by the Fitoverse website.
-- Purely additive: three new tables, plus one new row in "lead_sources" (the
-- "website" source used by Move to CRM). Nothing existing is altered, and every
-- statement is guarded so a re-run is harmless.

-- CreateTable
CREATE TABLE IF NOT EXISTS "website_leads" (
    "id" TEXT NOT NULL,
    "website_lead_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "normalized_phone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "state" TEXT,
    "job_title" TEXT,
    "sport" TEXT,
    "area_sqft" INTEGER,
    "length_ft" INTEGER,
    "width_ft" INTEGER,
    "start_when" TEXT,
    "notes" TEXT,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "surface" TEXT,
    "env" TEXT,
    "source" TEXT,
    "user_agent" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "assigned_to_user_id" TEXT,
    "account_contact_id" TEXT,
    "contact_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "website_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "website_lead_notes" (
    "id" TEXT NOT NULL,
    "website_lead_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "website_lead_to_labels" (
    "website_lead_id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "labeled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_lead_to_labels_pkey" PRIMARY KEY ("website_lead_id","label_id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "website_leads_website_lead_id_key" ON "website_leads"("website_lead_id");
CREATE INDEX IF NOT EXISTS "website_leads_received_at_idx" ON "website_leads"("received_at");
CREATE INDEX IF NOT EXISTS "website_leads_normalized_phone_idx" ON "website_leads"("normalized_phone");
CREATE INDEX IF NOT EXISTS "website_leads_stage_idx" ON "website_leads"("stage");
CREATE INDEX IF NOT EXISTS "website_leads_assigned_to_user_id_idx" ON "website_leads"("assigned_to_user_id");
CREATE INDEX IF NOT EXISTS "website_lead_notes_website_lead_id_created_at_idx" ON "website_lead_notes"("website_lead_id", "created_at");
CREATE INDEX IF NOT EXISTS "website_lead_to_labels_label_id_idx" ON "website_lead_to_labels"("label_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'website_leads_assigned_to_user_id_fkey') THEN
        ALTER TABLE "website_leads" ADD CONSTRAINT "website_leads_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'website_lead_notes_website_lead_id_fkey') THEN
        ALTER TABLE "website_lead_notes" ADD CONSTRAINT "website_lead_notes_website_lead_id_fkey" FOREIGN KEY ("website_lead_id") REFERENCES "website_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'website_lead_notes_author_user_id_fkey') THEN
        ALTER TABLE "website_lead_notes" ADD CONSTRAINT "website_lead_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'website_lead_to_labels_website_lead_id_fkey') THEN
        ALTER TABLE "website_lead_to_labels" ADD CONSTRAINT "website_lead_to_labels_website_lead_id_fkey" FOREIGN KEY ("website_lead_id") REFERENCES "website_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'website_lead_to_labels_label_id_fkey') THEN
        ALTER TABLE "website_lead_to_labels" ADD CONSTRAINT "website_lead_to_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "meta_lead_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- The "Website" lead source that Move to CRM attributes website leads to.
-- (The unique slug makes a re-run, or a source made by hand, a no-op.)
INSERT INTO "lead_sources" ("id", "name", "slug", "sort_order", "is_active", "created_at")
VALUES (gen_random_uuid()::text, 'Website', 'website', 0, true, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
