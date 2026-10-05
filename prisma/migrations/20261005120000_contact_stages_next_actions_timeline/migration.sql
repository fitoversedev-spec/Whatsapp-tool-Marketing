-- AlterTable
ALTER TABLE "account_contacts" ADD COLUMN     "lead_stage_id" TEXT;

-- AlterTable
ALTER TABLE "account_contact_notes" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "edited_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "account_contact_attachments" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "lead_stages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "color_hex" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_next_actions" (
    "id" TEXT NOT NULL,
    "account_contact_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "due_at" TIMESTAMP(3),
    "done_at" TIMESTAMP(3),
    "done_by_user_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "reminder_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contact_next_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_insights" (
    "id" TEXT NOT NULL,
    "account_contact_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contact_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_events" (
    "id" TEXT NOT NULL,
    "account_contact_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "visibility" TEXT,
    "ref_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_stages_is_active_sort_order_idx" ON "lead_stages"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "contact_next_actions_reminder_id_key" ON "contact_next_actions"("reminder_id");

-- CreateIndex
CREATE INDEX "contact_next_actions_account_contact_id_deleted_at_idx" ON "contact_next_actions"("account_contact_id", "deleted_at");

-- CreateIndex
CREATE INDEX "contact_insights_account_contact_id_author_user_id_idx" ON "contact_insights"("account_contact_id", "author_user_id");

-- CreateIndex
CREATE INDEX "contact_events_account_contact_id_at_idx" ON "contact_events"("account_contact_id", "at");

-- CreateIndex
CREATE INDEX "account_contacts_lead_stage_id_idx" ON "account_contacts"("lead_stage_id");

-- AddForeignKey
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_lead_stage_id_fkey" FOREIGN KEY ("lead_stage_id") REFERENCES "lead_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_next_actions" ADD CONSTRAINT "contact_next_actions_account_contact_id_fkey" FOREIGN KEY ("account_contact_id") REFERENCES "account_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_next_actions" ADD CONSTRAINT "contact_next_actions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_next_actions" ADD CONSTRAINT "contact_next_actions_done_by_user_id_fkey" FOREIGN KEY ("done_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_next_actions" ADD CONSTRAINT "contact_next_actions_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "reminders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_insights" ADD CONSTRAINT "contact_insights_account_contact_id_fkey" FOREIGN KEY ("account_contact_id") REFERENCES "account_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_insights" ADD CONSTRAINT "contact_insights_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_events" ADD CONSTRAINT "contact_events_account_contact_id_fkey" FOREIGN KEY ("account_contact_id") REFERENCES "account_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_events" ADD CONSTRAINT "contact_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Seed the 8 sales stages from the team's pipeline doc (admin-editable afterwards).
INSERT INTO "lead_stages" ("id", "name", "slug", "sort_order", "is_active", "color_hex")
VALUES
  (gen_random_uuid(), 'Lead Generation',       'lead_generation',       0, true, '#64748b'),
  (gen_random_uuid(), 'Initial Outreach',      'initial_outreach',      1, true, '#3b82f6'),
  (gen_random_uuid(), 'Proposal Development',  'proposal_development',  2, true, '#a855f7'),
  (gen_random_uuid(), 'Proposal Presentation', 'proposal_presentation', 3, true, '#f59e0b'),
  (gen_random_uuid(), 'Negotiation',           'negotiation',           4, true, '#f97316'),
  (gen_random_uuid(), 'Follow Up',             'follow_up',             5, true, '#3b82f6'),
  (gen_random_uuid(), 'Closing',               'closing',               6, true, '#10b981'),
  (gen_random_uuid(), 'Post-Sales Analysis',   'post_sales_analysis',   7, true, '#64748b');

-- Everyone already in Leads starts at the first stage.
UPDATE "account_contacts"
SET "lead_stage_id" = (SELECT "id" FROM "lead_stages" WHERE "slug" = 'lead_generation')
WHERE "pipeline_stage" = 'LEAD' AND "deleted_at" IS NULL AND "lead_stage_id" IS NULL;

-- Carry the old deal-level "next action" over to its contact's new Next actions list.
INSERT INTO "contact_next_actions" ("id", "account_contact_id", "text", "due_at", "created_by_user_id", "created_at", "updated_at")
SELECT gen_random_uuid(), d."primary_contact_id", d."next_action_note", d."next_action_due_at",
       COALESCE(d."owner_user_id", (SELECT "id" FROM "users" WHERE "role" = 'admin' AND "deleted_at" IS NULL ORDER BY "created_at" LIMIT 1)),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "deals" d
WHERE d."deleted_at" IS NULL
  AND d."primary_contact_id" IS NOT NULL
  AND d."next_action_note" IS NOT NULL
  AND btrim(d."next_action_note") <> '';
