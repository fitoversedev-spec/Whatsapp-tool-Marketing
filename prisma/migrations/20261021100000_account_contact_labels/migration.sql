-- Labels on CRM contacts: applies the shared "meta_lead_labels" catalogue (the one
-- ad leads and website leads already use) to "account_contacts".
-- Purely additive: one new table. Nothing existing is altered, and every
-- statement is guarded so a re-run is harmless.

-- CreateTable
CREATE TABLE IF NOT EXISTS "account_contact_labels" (
    "account_contact_id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "labeled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_contact_labels_pkey" PRIMARY KEY ("account_contact_id","label_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "account_contact_labels_label_id_idx" ON "account_contact_labels"("label_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_contact_labels_account_contact_id_fkey') THEN
        ALTER TABLE "account_contact_labels" ADD CONSTRAINT "account_contact_labels_account_contact_id_fkey" FOREIGN KEY ("account_contact_id") REFERENCES "account_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_contact_labels_label_id_fkey') THEN
        ALTER TABLE "account_contact_labels" ADD CONSTRAINT "account_contact_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "meta_lead_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
