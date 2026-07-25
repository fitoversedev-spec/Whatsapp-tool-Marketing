-- Performance indexes (additive only — no column/type/behavior changes).
-- These cover hot CRM-list and analytics query patterns that were previously
-- seq scans. Names match Prisma's @@index naming so schema + DB stay in sync.

-- Rep CRM lists (Contacts/Leads/Companies) scope accounts by owner + deletedAt.
CREATE INDEX IF NOT EXISTS "accounts_owner_user_id_deleted_at_idx" ON "accounts"("owner_user_id", "deleted_at");

-- Contacts list: WHERE deleted_at IS NULL ORDER BY created_at DESC.
CREATE INDEX IF NOT EXISTS "account_contacts_deleted_at_created_at_idx" ON "account_contacts"("deleted_at", "created_at");

-- Leads-window analytics + bulk-promote: pipeline_stage='LEAD' over a promoted_to_lead_at range.
CREATE INDEX IF NOT EXISTS "account_contacts_pipeline_stage_promoted_to_lead_at_idx" ON "account_contacts"("pipeline_stage", "promoted_to_lead_at");

-- Contact/deal detail pages: deals looked up by primary_contact_id.
CREATE INDEX IF NOT EXISTS "deals_primary_contact_id_idx" ON "deals"("primary_contact_id");

-- salesActivity type+date groupBys (site_visit / sample_dispatch) with no owner predicate.
CREATE INDEX IF NOT EXISTS "activities_activity_type_id_occurred_at_idx" ON "activities"("activity_type_id", "occurred_at");
