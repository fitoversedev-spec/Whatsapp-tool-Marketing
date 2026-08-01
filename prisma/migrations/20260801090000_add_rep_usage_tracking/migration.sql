-- Rep Usage analytics (active-time tracking) — additive; no existing table touched.

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "active_seconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_hourly" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "hour_start_at" TIMESTAMP(3) NOT NULL,
    "active_seconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "usage_hourly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_sessions_user_id_ended_at_idx" ON "user_sessions"("user_id", "ended_at");
CREATE INDEX "user_sessions_last_seen_at_idx" ON "user_sessions"("last_seen_at");
CREATE UNIQUE INDEX "usage_hourly_user_id_hour_start_at_key" ON "usage_hourly"("user_id", "hour_start_at");
CREATE INDEX "usage_hourly_user_id_hour_start_at_idx" ON "usage_hourly"("user_id", "hour_start_at");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_hourly" ADD CONSTRAINT "usage_hourly_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
