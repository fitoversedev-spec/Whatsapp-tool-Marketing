-- CreateTable
CREATE TABLE "decision_log" (
    "id" TEXT NOT NULL,
    "recorded_by_user_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "triggered_by_insight_id" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "decision_log_decided_at_idx" ON "decision_log"("decided_at");

-- AddForeignKey
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

