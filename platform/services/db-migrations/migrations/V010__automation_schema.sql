CREATE SCHEMA IF NOT EXISTS automation;

-- HUMAN_REVIEW: disposition_log is the authoritative audit trail for all automation gate decisions.
-- Retention policy, archival, and access controls should be reviewed by compliance before production.

CREATE TABLE automation.disposition_log (
  disposition_id  TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  case_ref        TEXT NOT NULL,
  analysis_id     TEXT NOT NULL,
  proposed_outcome TEXT NOT NULL,
  allow           BOOLEAN NOT NULL,
  deny_reasons    TEXT[] NOT NULL DEFAULT '{}',
  dry_run         BOOLEAN NOT NULL DEFAULT true,
  system_user_id  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE automation.disposition_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation.disposition_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation.disposition_log
  USING (tenant_id = current_setting('sim.tenant_id', true));

CREATE INDEX automation_disposition_log_tenant_case_idx
  ON automation.disposition_log (tenant_id, case_ref, created_at DESC);
