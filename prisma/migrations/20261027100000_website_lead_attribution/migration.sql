-- Website leads: where each enquiry came from (referrer / UTM / ad click) and the
-- page it landed on. Purely additive: four nullable columns and one index on
-- "website_leads". Existing rows stay NULL ("Unknown" in the app). Every statement
-- is guarded so a re-run is harmless.

-- AlterTable
ALTER TABLE "website_leads" ADD COLUMN IF NOT EXISTS "came_from" TEXT;
ALTER TABLE "website_leads" ADD COLUMN IF NOT EXISTS "came_from_group" TEXT;
ALTER TABLE "website_leads" ADD COLUMN IF NOT EXISTS "landing_page" TEXT;
ALTER TABLE "website_leads" ADD COLUMN IF NOT EXISTS "attribution" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "website_leads_came_from_idx" ON "website_leads"("came_from");
