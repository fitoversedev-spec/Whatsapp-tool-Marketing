-- Add sport tagging to campaigns (for campaigns whose forms lack a sport question)
ALTER TABLE "meta_campaigns" ADD COLUMN "sport" TEXT;
