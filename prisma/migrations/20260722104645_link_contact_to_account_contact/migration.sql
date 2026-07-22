-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "account_contact_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "contacts_account_contact_id_key" ON "contacts"("account_contact_id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_contact_id_fkey" FOREIGN KEY ("account_contact_id") REFERENCES "account_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
