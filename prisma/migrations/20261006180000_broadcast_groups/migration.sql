-- Broadcast groups: named, shared lists of WhatsApp contacts a broadcast can
-- target. Two new tables only — nothing existing is altered.

-- CreateTable
CREATE TABLE "broadcast_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcast_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_group_members" (
    "group_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "added_by_user_id" TEXT,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_group_members_pkey" PRIMARY KEY ("group_id","contact_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_groups_name_key" ON "broadcast_groups"("name");

-- CreateIndex
CREATE INDEX "broadcast_groups_created_by_user_id_idx" ON "broadcast_groups"("created_by_user_id");

-- CreateIndex
CREATE INDEX "broadcast_group_members_contact_id_idx" ON "broadcast_group_members"("contact_id");

-- AddForeignKey
ALTER TABLE "broadcast_groups" ADD CONSTRAINT "broadcast_groups_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_group_members" ADD CONSTRAINT "broadcast_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "broadcast_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_group_members" ADD CONSTRAINT "broadcast_group_members_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
