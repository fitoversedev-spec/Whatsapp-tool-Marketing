-- Meta lead management: Stage / Assigned-to / Reminder / Notes / Labels for the
-- Meta-Leads-Centre-style sidebar on the lead detail page.
-- Additive only: 3 new columns on meta_leads (+2 indexes) + 3 new tables.

-- AlterTable: lead-management columns on the existing meta_leads.
-- stage defaults to 'NEW' so every already-captured lead reads as a fresh lead.
ALTER TABLE "meta_leads" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'NEW';
ALTER TABLE "meta_leads" ADD COLUMN "reminder_at" TIMESTAMP(3);
ALTER TABLE "meta_leads" ADD COLUMN "assigned_to_user_id" TEXT;

-- CreateTable: running note log per lead.
CREATE TABLE "meta_lead_notes" (
    "id" TEXT NOT NULL,
    "meta_lead_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: colour-coded label catalogue.
CREATE TABLE "meta_lead_labels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_lead_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable: lead <-> label join.
CREATE TABLE "meta_lead_to_labels" (
    "meta_lead_id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "labeled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_lead_to_labels_pkey" PRIMARY KEY ("meta_lead_id","label_id")
);

-- CreateIndex
CREATE INDEX "meta_leads_assigned_to_user_id_idx" ON "meta_leads"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "meta_leads_stage_idx" ON "meta_leads"("stage");

-- CreateIndex
CREATE INDEX "meta_lead_notes_meta_lead_id_created_at_idx" ON "meta_lead_notes"("meta_lead_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "meta_lead_labels_name_key" ON "meta_lead_labels"("name");

-- CreateIndex
CREATE INDEX "meta_lead_to_labels_label_id_idx" ON "meta_lead_to_labels"("label_id");

-- AddForeignKey
ALTER TABLE "meta_leads" ADD CONSTRAINT "meta_leads_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_lead_notes" ADD CONSTRAINT "meta_lead_notes_meta_lead_id_fkey" FOREIGN KEY ("meta_lead_id") REFERENCES "meta_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_lead_notes" ADD CONSTRAINT "meta_lead_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_lead_to_labels" ADD CONSTRAINT "meta_lead_to_labels_meta_lead_id_fkey" FOREIGN KEY ("meta_lead_id") REFERENCES "meta_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_lead_to_labels" ADD CONSTRAINT "meta_lead_to_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "meta_lead_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
