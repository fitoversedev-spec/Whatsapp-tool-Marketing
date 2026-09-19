-- CreateEnum
CREATE TYPE "analysis_status" AS ENUM ('pending', 'running', 'partial', 'completed', 'failed');

-- AlterEnum
ALTER TYPE "report_kind" ADD VALUE 'analysis';
ALTER TYPE "report_kind" ADD VALUE 'combined';

-- AlterTable: add analysis FK on reports
ALTER TABLE "reports" ADD COLUMN "analysis_id" UUID;

-- CreateTable: scout_analyses
CREATE TABLE "scout_analyses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scan_id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "source_analysis_id" UUID,
    "status" "analysis_status" NOT NULL DEFAULT 'pending',
    "total_places" INTEGER NOT NULL DEFAULT 0,
    "completed_places" INTEGER NOT NULL DEFAULT 0,
    "failed_places" INTEGER NOT NULL DEFAULT 0,
    "area_summary" JSONB,
    "cost_estimate" JSONB,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable: scout_place_insights
CREATE TABLE "scout_place_insights" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "analysis_id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "google_place_id" VARCHAR(255) NOT NULL,
    "status" "analysis_status" NOT NULL DEFAULT 'pending',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "established_date" JSONB,
    "popular_times" JSONB,
    "sentiment" JSONB,
    "suitability" JSONB,
    "raw_sources" JSONB,
    "edited_fields" JSONB,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "analysed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_place_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scout_analyses_scan_owner_uniq" ON "scout_analyses"("scan_id", "owner_id");
CREATE INDEX "scout_analyses_owner_idx" ON "scout_analyses"("owner_id");
CREATE INDEX "scout_analyses_status_idx" ON "scout_analyses"("status");

CREATE UNIQUE INDEX "scout_place_insights_analysis_place_uniq" ON "scout_place_insights"("analysis_id", "place_id");
CREATE INDEX "scout_place_insights_place_idx" ON "scout_place_insights"("place_id");
CREATE INDEX "scout_place_insights_status_idx" ON "scout_place_insights"("status");

CREATE INDEX "reports_analysis_idx" ON "reports"("analysis_id");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_analysis_id_scout_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "scout_analyses"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "scout_analyses" ADD CONSTRAINT "scout_analyses_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "scout_analyses" ADD CONSTRAINT "scout_analyses_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "scout_analyses" ADD CONSTRAINT "scout_analyses_source_id_fk" FOREIGN KEY ("source_analysis_id") REFERENCES "scout_analyses"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "scout_place_insights" ADD CONSTRAINT "scout_place_insights_analysis_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "scout_analyses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "scout_place_insights" ADD CONSTRAINT "scout_place_insights_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
