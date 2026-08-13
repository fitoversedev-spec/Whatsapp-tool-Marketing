-- Meta Marketing API + Lead Ads: ad-campaign performance + lead-gen leads.
-- Additive only (3 new tables + indexes + 1 FK); touches no existing table.

-- CreateTable
CREATE TABLE "meta_campaigns" (
    "id" TEXT NOT NULL,
    "meta_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "status" TEXT,
    "created_at_meta" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_insights" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "ctr" DECIMAL(8,4),
    "cpl" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_leads" (
    "id" TEXT NOT NULL,
    "leadgen_id" TEXT NOT NULL,
    "form_id" TEXT,
    "form_name" TEXT,
    "page_id" TEXT,
    "ad_id" TEXT,
    "campaign_id" TEXT,
    "campaign_name" TEXT,
    "full_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "sport" TEXT,
    "field_data" TEXT NOT NULL,
    "raw_payload" TEXT,
    "created_at_meta" TIMESTAMP(3),
    "lead_id" TEXT,
    "account_contact_id" TEXT,
    "normalized_phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meta_campaigns_meta_id_key" ON "meta_campaigns"("meta_id");

-- CreateIndex
CREATE INDEX "meta_campaigns_ad_account_id_idx" ON "meta_campaigns"("ad_account_id");

-- CreateIndex
CREATE INDEX "ad_insights_date_idx" ON "ad_insights"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ad_insights_campaign_id_date_key" ON "ad_insights"("campaign_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "meta_leads_leadgen_id_key" ON "meta_leads"("leadgen_id");

-- CreateIndex
CREATE INDEX "meta_leads_page_id_idx" ON "meta_leads"("page_id");

-- CreateIndex
CREATE INDEX "meta_leads_campaign_id_idx" ON "meta_leads"("campaign_id");

-- CreateIndex
CREATE INDEX "meta_leads_created_at_meta_idx" ON "meta_leads"("created_at_meta");

-- CreateIndex
CREATE INDEX "meta_leads_normalized_phone_idx" ON "meta_leads"("normalized_phone");

-- AddForeignKey
ALTER TABLE "ad_insights" ADD CONSTRAINT "ad_insights_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "meta_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
