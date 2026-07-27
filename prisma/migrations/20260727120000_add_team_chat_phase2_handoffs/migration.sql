-- Internal Team Chat (Phase 2) — handoffs + availability. Additive.

-- CreateTable
CREATE TABLE "handoff_requests" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "account_contact_id" TEXT,
    "deal_id" TEXT,
    "from_user_id" TEXT NOT NULL,
    "to_user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "coverage_start" TIMESTAMP(3),
    "coverage_end" TIMESTAMP(3),
    "approved_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handoff_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coverage_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_contact_id" TEXT,
    "deal_id" TEXT,
    "handoff_request_id" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coverage_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_availability" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "handoff_requests_to_user_id_status_idx" ON "handoff_requests"("to_user_id", "status");
CREATE INDEX "handoff_requests_from_user_id_status_idx" ON "handoff_requests"("from_user_id", "status");
CREATE INDEX "coverage_grants_user_id_expires_at_idx" ON "coverage_grants"("user_id", "expires_at");
CREATE INDEX "coverage_grants_account_contact_id_idx" ON "coverage_grants"("account_contact_id");
CREATE INDEX "coverage_grants_deal_id_idx" ON "coverage_grants"("deal_id");
CREATE INDEX "user_availability_user_id_ends_at_idx" ON "user_availability"("user_id", "ends_at");

-- AddForeignKey
ALTER TABLE "handoff_requests" ADD CONSTRAINT "handoff_requests_account_contact_id_fkey" FOREIGN KEY ("account_contact_id") REFERENCES "account_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "handoff_requests" ADD CONSTRAINT "handoff_requests_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "handoff_requests" ADD CONSTRAINT "handoff_requests_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "handoff_requests" ADD CONSTRAINT "handoff_requests_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "handoff_requests" ADD CONSTRAINT "handoff_requests_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "coverage_grants" ADD CONSTRAINT "coverage_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coverage_grants" ADD CONSTRAINT "coverage_grants_account_contact_id_fkey" FOREIGN KEY ("account_contact_id") REFERENCES "account_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coverage_grants" ADD CONSTRAINT "coverage_grants_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coverage_grants" ADD CONSTRAINT "coverage_grants_handoff_request_id_fkey" FOREIGN KEY ("handoff_request_id") REFERENCES "handoff_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_availability" ADD CONSTRAINT "user_availability_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
