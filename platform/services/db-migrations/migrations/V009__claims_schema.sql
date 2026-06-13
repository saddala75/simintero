-- V009__claims_schema.sql
-- Extend ens.case with case_type column for claim/appeal variants
ALTER TABLE ens.case ADD COLUMN IF NOT EXISTS case_type TEXT NOT NULL DEFAULT 'prior_auth';

CREATE SCHEMA IF NOT EXISTS claims;

CREATE TABLE claims.claim (
  claim_id           TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  case_id            UUID NOT NULL REFERENCES ens.case(case_id),
  claim_number       TEXT NOT NULL,
  service_date_start DATE NOT NULL,
  service_date_end   DATE NOT NULL,
  total_billed_usd   NUMERIC(12,4) NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'submitted',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE claims.claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims.claim FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON claims.claim
  USING (tenant_id = current_setting('sim.tenant_id', true));
CREATE UNIQUE INDEX ON claims.claim (tenant_id, claim_number);
CREATE INDEX ON claims.claim (tenant_id, case_id);

CREATE TABLE claims.appeal (
  appeal_id          TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  appeal_case_id     UUID NOT NULL REFERENCES ens.case(case_id),
  original_case_id   UUID NOT NULL REFERENCES ens.case(case_id),
  appeal_type        TEXT NOT NULL CHECK (appeal_type IN ('standard', 'expedited', 'iro')),
  filed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE claims.appeal ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims.appeal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON claims.appeal
  USING (tenant_id = current_setting('sim.tenant_id', true));
CREATE INDEX ON claims.appeal (tenant_id, appeal_case_id);
CREATE INDEX ON claims.appeal (tenant_id, original_case_id);
