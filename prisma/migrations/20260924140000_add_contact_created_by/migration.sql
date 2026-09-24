-- AlterTable
ALTER TABLE "account_contacts" ADD COLUMN "created_by_user_id" TEXT;

-- AddForeignKey
ALTER TABLE "account_contacts"
ADD CONSTRAINT "account_contacts_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
