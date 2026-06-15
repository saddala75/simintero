-- T11: Decision store — two-phase lifecycle
-- Phase 1: row created at $submit time (outcome IS NULL = pending)
-- Phase 2: row updated when decision.recorded arrives (outcome IS NOT NULL = complete)

CREATE TABLE IF NOT EXISTS decision_store (
    id             BIGSERIAL PRIMARY KEY,
    case_id        UUID,
    tenant_id      TEXT        NOT NULL,
    correlation_id TEXT        NOT NULL,
    claim_ref      TEXT        NOT NULL,
    outcome        TEXT,                        -- NULL until decision.recorded arrives
    rule_artifact  TEXT,
    rule_version   TEXT,
    auto_approved  BOOLEAN,
    decided_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary lookup: $inquire queries by (tenant_id, correlation_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_store_tenant_corr
    ON decision_store (tenant_id, correlation_id);

-- Secondary lookup: DecisionEventConsumer queries by (case_id, tenant_id)
CREATE INDEX IF NOT EXISTS idx_decision_store_case
    ON decision_store (case_id, tenant_id);
