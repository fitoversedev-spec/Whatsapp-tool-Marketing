-- Add area/dimensions column to leads for analytics filtering
ALTER TABLE "meta_leads" ADD COLUMN "area" TEXT;
