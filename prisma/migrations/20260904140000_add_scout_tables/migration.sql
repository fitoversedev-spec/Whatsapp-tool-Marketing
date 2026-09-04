-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum (safe: skip if already exists)
DO $$ BEGIN CREATE TYPE "scan_status" AS ENUM ('draft', 'scanned', 'report_sent'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "place_side" AS ENUM ('competition', 'demand'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "report_channel" AS ENUM ('whatsapp', 'pdf', 'email'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "scan_job_status" AS ENUM ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "scan_task_status" AS ENUM ('pending', 'running', 'done', 'failed', 'skipped'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "report_status" AS ENUM ('draft', 'generating', 'generated', 'delivered', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "report_kind" AS ENUM ('scan', 'comparison'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "sites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "address" TEXT,
    "city" VARCHAR(120),
    "state" VARCHAR(120),
    "location" geography(Point, 4326),
    "customer_name" VARCHAR(200),
    "customer_phone" VARCHAR(40),
    "land_owner_name" VARCHAR(200),
    "area_sqft" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "score_models" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" VARCHAR(20) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "weights" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "includes_population" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT NOT NULL,
    "site_id" UUID,
    "area_label" VARCHAR(200) NOT NULL,
    "customer_name" VARCHAR(200),
    "address" TEXT,
    "centre" geography(Point, 4326) NOT NULL,
    "radius_m" INTEGER NOT NULL,
    "search_terms" JSONB NOT NULL DEFAULT '{}',
    "status" "scan_status" NOT NULL DEFAULT 'draft',
    "score_model_id" UUID,
    "score_model_version" VARCHAR(20),
    "score_total" DECIMAL(5,2),
    "score_verdict" VARCHAR(20),
    "score_basis" VARCHAR(16),
    "score_confidence" VARCHAR(10),
    "score_breakdown" JSONB,
    "scored_at" TIMESTAMPTZ(6),
    "surveyor_inputs" JSONB,
    "field_notes" TEXT,
    "sweep" JSONB,
    "facility_count" INTEGER,
    "demand_count" INTEGER,
    "review_count" INTEGER,
    "avg_rating" REAL,
    "saturation" JSONB,
    "stats" JSONB,
    "scanned_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "places" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "place_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "location" geography(Point, 4326) NOT NULL,
    "rating" REAL,
    "review_count" INTEGER,
    "address" TEXT,
    "hours" JSONB,
    "price_level" SMALLINT,
    "website" TEXT,
    "phone" VARCHAR(60),
    "google_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "business_status" VARCHAR(40),
    "primary_type" VARCHAR(80),
    "primary_type_display_name" VARCHAR(160),
    "google_maps_uri" TEXT,
    "operating_window" JSONB,
    "field_tier" VARCHAR(32),
    "cached_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cache_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "reviews_cached_at" TIMESTAMPTZ(6),
    "reviews_cache_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "scan_places" (
    "scan_id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "side" "place_side" NOT NULL,
    "distance_m" DOUBLE PRECISION,
    "anchor_weight" REAL,
    "matched_terms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_places_scan_id_place_id_pk" PRIMARY KEY ("scan_id","place_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "place_tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "place_id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "value" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "place_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "place_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "place_id" UUID NOT NULL,
    "google_review_id" VARCHAR(255),
    "author_name" VARCHAR(200),
    "rating" SMALLINT,
    "text" TEXT,
    "language_code" VARCHAR(16),
    "published_at" TIMESTAMPTZ(6),
    "cached_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cache_expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "place_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "review_themes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scan_id" UUID,
    "place_id" UUID,
    "review_hash" VARCHAR(64),
    "theme" VARCHAR(120) NOT NULL,
    "sentiment" VARCHAR(20),
    "mention_count" INTEGER NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "model_version" VARCHAR(60),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "scan_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scan_id" UUID NOT NULL,
    "status" "scan_job_status" NOT NULL DEFAULT 'queued',
    "total_tasks" INTEGER NOT NULL DEFAULT 0,
    "completed_tasks" INTEGER NOT NULL DEFAULT 0,
    "failed_tasks" INTEGER NOT NULL DEFAULT 0,
    "progress_label" TEXT,
    "tile_count" INTEGER NOT NULL DEFAULT 0,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(6),
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "cache_hits" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "scan_job_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "tile_index" INTEGER NOT NULL,
    "tile_centre" geography(Point, 4326) NOT NULL,
    "tile_radius_m" INTEGER NOT NULL,
    "category_id" VARCHAR(60) NOT NULL,
    "term_id" VARCHAR(60) NOT NULL,
    "term_label" VARCHAR(120) NOT NULL,
    "side" "place_side" NOT NULL,
    "mode" VARCHAR(16) NOT NULL,
    "field_tier" VARCHAR(32) NOT NULL,
    "status" "scan_task_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "result_count" INTEGER,
    "saturated" BOOLEAN NOT NULL DEFAULT false,
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_job_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "place_search_cache" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cache_key" VARCHAR(80) NOT NULL,
    "tile_centre" geography(Point, 4326) NOT NULL,
    "tile_radius_m" INTEGER NOT NULL,
    "term_id" VARCHAR(60) NOT NULL,
    "mode" VARCHAR(16) NOT NULL,
    "field_tier" VARCHAR(32) NOT NULL,
    "google_place_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "saturated" BOOLEAN NOT NULL DEFAULT false,
    "call_count" INTEGER NOT NULL DEFAULT 1,
    "cached_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cache_expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "place_search_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "api_usage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT,
    "scan_id" UUID,
    "endpoint" VARCHAR(40) NOT NULL,
    "sku_tier" VARCHAR(32) NOT NULL,
    "call_count" INTEGER NOT NULL DEFAULT 1,
    "cache_hits" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "outcome" VARCHAR(24) NOT NULL DEFAULT 'ok',
    "usage_date" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "population_grid" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location" geography(Point, 4326) NOT NULL,
    "population" DOUBLE PRECISION NOT NULL,
    "source" VARCHAR(80) NOT NULL,
    "vintage_year" INTEGER NOT NULL,
    "cell_size_m" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "population_grid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "census_district" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "census_code" VARCHAR(40) NOT NULL,
    "district_name" VARCHAR(160) NOT NULL,
    "state_name" VARCHAR(160) NOT NULL,
    "centroid" geography(Point, 4326),
    "total_population" INTEGER,
    "age_ratios" JSONB,
    "household_size_avg" REAL,
    "urban_share" REAL,
    "source" VARCHAR(80) NOT NULL DEFAULT 'census-india-2011',
    "vintage_year" INTEGER NOT NULL DEFAULT 2011,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "census_district_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "city_benchmarks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "city" VARCHAR(120) NOT NULL,
    "state" VARCHAR(120),
    "sport_format" VARCHAR(80),
    "facilities_per_anchor" REAL,
    "median_rating" REAL,
    "median_review_count" REAL,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "city_benchmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scan_id" UUID NOT NULL,
    "created_by" TEXT NOT NULL,
    "title" VARCHAR(240),
    "kind" "report_kind" NOT NULL DEFAULT 'scan',
    "subject_scan_ids" JSONB,
    "included_blocks" JSONB,
    "field_notes" TEXT,
    "score_model_version" VARCHAR(20),
    "version" INTEGER NOT NULL DEFAULT 1,
    "pdf_blob_key" TEXT,
    "pdf_bytes" INTEGER,
    "pdf_sha256" VARCHAR(64),
    "page_count" INTEGER,
    "pdf_engine" VARCHAR(40),
    "generated_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "status" "report_status" NOT NULL DEFAULT 'draft',
    "channel" "report_channel",
    "sent_to" VARCHAR(200),
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "report_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "report_id" UUID NOT NULL,
    "content_type" VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
    "byte_size" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "report_shares" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "report_id" UUID NOT NULL,
    "scan_id" UUID NOT NULL,
    "shared_by" TEXT NOT NULL,
    "channel" "report_channel" NOT NULL,
    "recipient_name" VARCHAR(200),
    "link_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "sites_owner_idx" ON "sites"("owner_id");
CREATE INDEX IF NOT EXISTS "sites_city_idx" ON "sites"("city");

CREATE UNIQUE INDEX IF NOT EXISTS "score_models_version_idx" ON "score_models"("version");

CREATE INDEX IF NOT EXISTS "scans_owner_idx" ON "scans"("owner_id");
CREATE INDEX IF NOT EXISTS "scans_site_idx" ON "scans"("site_id");
CREATE INDEX IF NOT EXISTS "scans_status_idx" ON "scans"("status");
CREATE INDEX IF NOT EXISTS "scans_created_at_idx" ON "scans"("created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "places_place_id_idx" ON "places"("place_id");
CREATE INDEX IF NOT EXISTS "places_cache_expires_idx" ON "places"("cache_expires_at");

CREATE INDEX IF NOT EXISTS "scan_places_place_idx" ON "scan_places"("place_id");
CREATE INDEX IF NOT EXISTS "scan_places_side_idx" ON "scan_places"("scan_id", "side");
CREATE INDEX IF NOT EXISTS "scan_places_categories_gin" ON "scan_places" USING GIN ("categories");

CREATE UNIQUE INDEX IF NOT EXISTS "place_tags_place_key_idx" ON "place_tags"("place_id", "key");

CREATE UNIQUE INDEX IF NOT EXISTS "place_reviews_google_id_idx" ON "place_reviews"("google_review_id");
CREATE INDEX IF NOT EXISTS "place_reviews_place_idx" ON "place_reviews"("place_id");

CREATE UNIQUE INDEX IF NOT EXISTS "review_themes_place_hash_theme_idx" ON "review_themes"("place_id", "review_hash", "theme");
CREATE INDEX IF NOT EXISTS "review_themes_scan_idx" ON "review_themes"("scan_id");
CREATE INDEX IF NOT EXISTS "review_themes_place_idx" ON "review_themes"("place_id");

CREATE UNIQUE INDEX IF NOT EXISTS "scan_jobs_scan_idx" ON "scan_jobs"("scan_id");
CREATE INDEX IF NOT EXISTS "scan_jobs_status_idx" ON "scan_jobs"("status");
CREATE INDEX IF NOT EXISTS "scan_jobs_lease_idx" ON "scan_jobs"("lease_expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "scan_job_tasks_unique_idx" ON "scan_job_tasks"("job_id", "tile_index", "term_id");
CREATE INDEX IF NOT EXISTS "scan_job_tasks_claim_idx" ON "scan_job_tasks"("job_id", "status", "tile_index");

CREATE UNIQUE INDEX IF NOT EXISTS "place_search_cache_key_idx" ON "place_search_cache"("cache_key");
CREATE INDEX IF NOT EXISTS "place_search_cache_expires_idx" ON "place_search_cache"("cache_expires_at");

CREATE INDEX IF NOT EXISTS "api_usage_user_date_idx" ON "api_usage"("user_id", "usage_date");
CREATE INDEX IF NOT EXISTS "api_usage_scan_idx" ON "api_usage"("scan_id");
CREATE INDEX IF NOT EXISTS "api_usage_created_at_idx" ON "api_usage"("created_at");

CREATE INDEX IF NOT EXISTS "population_grid_source_vintage_idx" ON "population_grid"("source", "vintage_year");

CREATE UNIQUE INDEX IF NOT EXISTS "census_district_code_idx" ON "census_district"("census_code");

CREATE UNIQUE INDEX IF NOT EXISTS "city_benchmarks_city_format_idx" ON "city_benchmarks"("city", "sport_format");

CREATE INDEX IF NOT EXISTS "reports_scan_idx" ON "reports"("scan_id");
CREATE INDEX IF NOT EXISTS "reports_created_by_idx" ON "reports"("created_by");
CREATE INDEX IF NOT EXISTS "reports_status_idx" ON "reports"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "report_files_report_idx" ON "report_files"("report_id");

CREATE INDEX IF NOT EXISTS "report_shares_report_idx" ON "report_shares"("report_id");
CREATE INDEX IF NOT EXISTS "report_shares_scan_idx" ON "report_shares"("scan_id");

-- AddForeignKey (safe: skip if already exists)
DO $$ BEGIN ALTER TABLE "sites" ADD CONSTRAINT "sites_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "scans" ADD CONSTRAINT "scans_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "scans" ADD CONSTRAINT "scans_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "scans" ADD CONSTRAINT "scans_score_model_id_score_models_id_fk" FOREIGN KEY ("score_model_id") REFERENCES "score_models"("id") ON DELETE SET NULL ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "scan_places" ADD CONSTRAINT "scan_places_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "scan_places" ADD CONSTRAINT "scan_places_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "place_tags" ADD CONSTRAINT "place_tags_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "place_tags" ADD CONSTRAINT "place_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "place_reviews" ADD CONSTRAINT "place_reviews_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "review_themes" ADD CONSTRAINT "review_themes_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "review_themes" ADD CONSTRAINT "review_themes_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "scan_job_tasks" ADD CONSTRAINT "scan_job_tasks_job_id_scan_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE SET NULL ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "reports" ADD CONSTRAINT "reports_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "report_files" ADD CONSTRAINT "report_files_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_shared_by_users_id_fk" FOREIGN KEY ("shared_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
