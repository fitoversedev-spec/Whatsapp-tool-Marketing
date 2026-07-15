-- AlterTable
ALTER TABLE "bot_leads" ADD COLUMN     "lead_id" TEXT;

-- CreateTable
CREATE TABLE "funnel_stages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "color_hex" TEXT,
    "stage_type" TEXT NOT NULL,
    "probability_percent" INTEGER,
    "sla_hours" INTEGER,
    "requires_loss_reason" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnel_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "color_hex" TEXT,
    "parent_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "color_hex" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "city_tiers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "color_hex" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "city_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loss_reasons" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "color_hex" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loss_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "color_hex" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customer_profile_id" TEXT,
    "business_type" TEXT,
    "city" TEXT,
    "city_tier_id" TEXT,
    "owner_user_id" TEXT,
    "parent_account_id" TEXT,
    "gstin" TEXT,
    "notes" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_contacts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "designation" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "city" TEXT,
    "raw_enquiry_text" TEXT,
    "lead_source_id" TEXT,
    "source_detail" TEXT,
    "owner_user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "converted_deal_id" TEXT,
    "converted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "primary_contact_id" TEXT,
    "owner_user_id" TEXT,
    "office_id" TEXT,
    "current_stage_id" TEXT NOT NULL,
    "lead_source_id" TEXT,
    "source_detail" TEXT,
    "conversation_id" TEXT,
    "site_city" TEXT,
    "site_city_tier_id" TEXT,
    "site_state" TEXT,
    "site_address" TEXT,
    "estimated_value" DECIMAL(12,2),
    "quoted_value" DECIMAL(12,2),
    "won_value" DECIMAL(12,2),
    "enquiry_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_contact_at" TIMESTAMP(3),
    "site_visit_at" TIMESTAMP(3),
    "sample_sent_at" TIMESTAMP(3),
    "first_quoted_at" TIMESTAMP(3),
    "negotiation_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "expected_close_at" TIMESTAMP(3),
    "outcome" TEXT,
    "loss_reason_id" TEXT,
    "loss_reason_note" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_stage_history" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "from_stage_id" TEXT,
    "to_stage_id" TEXT NOT NULL,
    "changed_by_user_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_in_from_stage_seconds" INTEGER,
    "note" TEXT,

    CONSTRAINT "deal_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_line_items" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "quotation_id" TEXT,
    "product_id" TEXT,
    "sport_id" TEXT,
    "label" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" TEXT,
    "rate" DECIMAL(12,2),
    "amount" DECIMAL(12,2),
    "is_enquiry_only" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sports" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT,
    "lead_id" TEXT,
    "account_id" TEXT,
    "activity_type_id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "notes" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "duration_mins" INTEGER,
    "outcome" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "funnel_stages_slug_key" ON "funnel_stages"("slug");

-- CreateIndex
CREATE INDEX "funnel_stages_is_active_sort_order_idx" ON "funnel_stages"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_slug_key" ON "lead_sources"("slug");

-- CreateIndex
CREATE INDEX "lead_sources_is_active_sort_order_idx" ON "lead_sources"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_slug_key" ON "customer_profiles"("slug");

-- CreateIndex
CREATE INDEX "customer_profiles_is_active_sort_order_idx" ON "customer_profiles"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "city_tiers_slug_key" ON "city_tiers"("slug");

-- CreateIndex
CREATE INDEX "city_tiers_is_active_sort_order_idx" ON "city_tiers"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "loss_reasons_slug_key" ON "loss_reasons"("slug");

-- CreateIndex
CREATE INDEX "loss_reasons_is_active_sort_order_idx" ON "loss_reasons"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "activity_types_slug_key" ON "activity_types"("slug");

-- CreateIndex
CREATE INDEX "activity_types_is_active_sort_order_idx" ON "activity_types"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "accounts_city_customer_profile_id_idx" ON "accounts"("city", "customer_profile_id");

-- CreateIndex
CREATE INDEX "account_contacts_account_id_idx" ON "account_contacts"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_converted_deal_id_key" ON "leads"("converted_deal_id");

-- CreateIndex
CREATE INDEX "leads_owner_user_id_created_at_idx" ON "leads"("owner_user_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_lead_source_id_created_at_idx" ON "leads"("lead_source_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "deals_code_key" ON "deals"("code");

-- CreateIndex
CREATE INDEX "deals_owner_user_id_current_stage_id_idx" ON "deals"("owner_user_id", "current_stage_id");

-- CreateIndex
CREATE INDEX "deals_site_city_created_at_idx" ON "deals"("site_city", "created_at");

-- CreateIndex
CREATE INDEX "deals_current_stage_id_expected_close_at_idx" ON "deals"("current_stage_id", "expected_close_at");

-- CreateIndex
CREATE INDEX "deal_stage_history_deal_id_changed_at_idx" ON "deal_stage_history"("deal_id", "changed_at");

-- CreateIndex
CREATE INDEX "deal_stage_history_to_stage_id_changed_at_idx" ON "deal_stage_history"("to_stage_id", "changed_at");

-- CreateIndex
CREATE INDEX "deal_line_items_product_id_deal_id_idx" ON "deal_line_items"("product_id", "deal_id");

-- CreateIndex
CREATE INDEX "deal_line_items_deal_id_idx" ON "deal_line_items"("deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "sports_slug_key" ON "sports"("slug");

-- CreateIndex
CREATE INDEX "activities_owner_user_id_occurred_at_idx" ON "activities"("owner_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_deal_id_occurred_at_idx" ON "activities"("deal_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "bot_leads" ADD CONSTRAINT "bot_leads_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_city_tier_id_fkey" FOREIGN KEY ("city_tier_id") REFERENCES "city_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_account_id_fkey" FOREIGN KEY ("parent_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_lead_source_id_fkey" FOREIGN KEY ("lead_source_id") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_deal_id_fkey" FOREIGN KEY ("converted_deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_primary_contact_id_fkey" FOREIGN KEY ("primary_contact_id") REFERENCES "account_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_current_stage_id_fkey" FOREIGN KEY ("current_stage_id") REFERENCES "funnel_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_lead_source_id_fkey" FOREIGN KEY ("lead_source_id") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_site_city_tier_id_fkey" FOREIGN KEY ("site_city_tier_id") REFERENCES "city_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_loss_reason_id_fkey" FOREIGN KEY ("loss_reason_id") REFERENCES "loss_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_from_stage_id_fkey" FOREIGN KEY ("from_stage_id") REFERENCES "funnel_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_to_stage_id_fkey" FOREIGN KEY ("to_stage_id") REFERENCES "funnel_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_activity_type_id_fkey" FOREIGN KEY ("activity_type_id") REFERENCES "activity_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
