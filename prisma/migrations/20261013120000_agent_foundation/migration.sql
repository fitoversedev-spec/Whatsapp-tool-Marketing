-- Fitoverse AI Sales Agent: foundation tables for the /api/agent/v1 integration
-- layer (service identity, API keys, tamper-resistant audit, approvals, rate
-- limits, idempotency, alerts). Purely additive: seven new tables, nothing
-- existing is altered. Every statement is guarded so a re-run is harmless.

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_credentials" (
    "id" TEXT NOT NULL,
    "identity_id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ip_allowlist" JSONB NOT NULL DEFAULT '[]',
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "last_used_ip" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "rotated_from_id" TEXT,

    CONSTRAINT "agent_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_audit_logs" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlation_id" TEXT NOT NULL,
    "identity_id" TEXT NOT NULL,
    "credential_id" TEXT,
    "environment" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "http_method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "ip" TEXT,
    "record_ids" JSONB NOT NULL DEFAULT '[]',
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "http_status" INTEGER NOT NULL,
    "fields_changed" JSONB,
    "approval_id" TEXT,
    "failure_reason" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "idempotency_key" TEXT,
    "row_hash" TEXT NOT NULL,

    CONSTRAINT "agent_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_approval_requests" (
    "id" TEXT NOT NULL,
    "identity_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "input_json" JSONB NOT NULL,
    "input_hash" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "executed_at" TIMESTAMP(3),
    "result_json" JSONB,
    "failure_reason" TEXT,

    CONSTRAINT "agent_approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_idempotency_keys" (
    "id" TEXT NOT NULL,
    "identity_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "response_status" INTEGER,
    "response_body" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_rate_buckets" (
    "identity_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "agent_rate_buckets_pkey" PRIMARY KEY ("identity_id","scope","window_start")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_alerts" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "acknowledged_by_user_id" TEXT,
    "acknowledged_at" TIMESTAMP(3),

    CONSTRAINT "agent_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agent_identities_user_id_key" ON "agent_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agent_credentials_key_id_key" ON "agent_credentials"("key_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_credentials_identity_id_environment_idx" ON "agent_credentials"("identity_id", "environment");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_audit_logs_at_idx" ON "agent_audit_logs"("at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_audit_logs_identity_id_at_idx" ON "agent_audit_logs"("identity_id", "at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_audit_logs_tool_name_at_idx" ON "agent_audit_logs"("tool_name", "at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_audit_logs_correlation_id_idx" ON "agent_audit_logs"("correlation_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_approval_requests_status_requested_at_idx" ON "agent_approval_requests"("status", "requested_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_approval_requests_identity_id_tool_name_input_hash_idx" ON "agent_approval_requests"("identity_id", "tool_name", "input_hash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agent_idempotency_keys_identity_id_key_key" ON "agent_idempotency_keys"("identity_id", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_idempotency_keys_expires_at_idx" ON "agent_idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_rate_buckets_window_start_idx" ON "agent_rate_buckets"("window_start");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_alerts_at_idx" ON "agent_alerts"("at");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_identities_user_id_fkey') THEN
        ALTER TABLE "agent_identities" ADD CONSTRAINT "agent_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_credentials_identity_id_fkey') THEN
        ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "agent_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Append-only audit log. The audit table has no foreign keys on purpose, and
-- these triggers refuse every way of changing or emptying it. (A database owner
-- could still drop the triggers; the application's DB role should not own the
-- table in production. Each row also carries a row_hash so a change made that
-- way is detectable.)
CREATE OR REPLACE FUNCTION agent_audit_logs_append_only() RETURNS trigger AS $fn$
BEGIN
    RAISE EXCEPTION 'agent_audit_logs is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'restrict_violation';
    RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "agent_audit_logs_no_update_delete" ON "agent_audit_logs";
CREATE TRIGGER "agent_audit_logs_no_update_delete"
    BEFORE UPDATE OR DELETE ON "agent_audit_logs"
    FOR EACH ROW EXECUTE FUNCTION agent_audit_logs_append_only();

DROP TRIGGER IF EXISTS "agent_audit_logs_no_truncate" ON "agent_audit_logs";
CREATE TRIGGER "agent_audit_logs_no_truncate"
    BEFORE TRUNCATE ON "agent_audit_logs"
    FOR EACH STATEMENT EXECUTE FUNCTION agent_audit_logs_append_only();
