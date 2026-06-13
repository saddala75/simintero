-- V014: Enstellar intake — Phase 1 columns on ens.case, new tables for service lines/tasks/pins
-- Migrated from modules/enstellar/intake/src/db/migrations/V005__ens_intake_columns.sql

-- 1. Add Phase 1 columns to ens.case (ALTER, not CREATE)
ALTER TABLE ens.case
  ADD COLUMN IF NOT EXISTS member_ref   TEXT,
  ADD COLUMN IF NOT EXISTS coverage_ref TEXT,
  ADD COLUMN IF NOT EXISTS origin       JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS providers    JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pins         JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS linked       JSONB NOT NULL DEFAULT '{"appeal_of":null,"related_cases":[]}';

-- 2. Create ens.service_line
CREATE TABLE IF NOT EXISTS ens.service_line (
  line_id          TEXT PRIMARY KEY,
  case_id          UUID NOT NULL REFERENCES ens.case(case_id),
  tenant_id        TEXT NOT NULL,
  code             JSONB NOT NULL,
  qty              NUMERIC NOT NULL DEFAULT 1,
  units            TEXT NOT NULL DEFAULT 'UN',
  place_of_service TEXT,
  requested_period JSONB NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','approved','partially_approved','denied','modified','withdrawn'))
);
ALTER TABLE ens.service_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE ens.service_line FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ens.service_line;
CREATE POLICY tenant_isolation ON ens.service_line
  USING (tenant_id = current_setting('sim.tenant_id', true));

CREATE INDEX IF NOT EXISTS idx_ens_case_member_ref ON ens.case (tenant_id, member_ref, created_at);
CREATE INDEX IF NOT EXISTS idx_ens_service_line_case_id ON ens.service_line (case_id);

-- 3. Create ens.case_pin
CREATE TABLE IF NOT EXISTS ens.case_pin (
  case_id       UUID NOT NULL REFERENCES ens.case(case_id),
  tenant_id     TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  version       TEXT NOT NULL,
  pinned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, canonical_url)
);
ALTER TABLE ens.case_pin ENABLE ROW LEVEL SECURITY;
ALTER TABLE ens.case_pin FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ens.case_pin;
CREATE POLICY tenant_isolation ON ens.case_pin
  USING (tenant_id = current_setting('sim.tenant_id', true));

-- 4. Add Phase 1 columns to fabric.resource
ALTER TABLE fabric.resource
  ADD COLUMN IF NOT EXISTS member_ref     TEXT,
  ADD COLUMN IF NOT EXISTS classification TEXT DEFAULT 'standard';
UPDATE fabric.resource SET provenance_ref = 'legacy:unknown' WHERE provenance_ref IS NULL;
ALTER TABLE fabric.resource ALTER COLUMN provenance_ref SET NOT NULL;

-- 5. Create ens.task
CREATE TABLE IF NOT EXISTS ens.task (
  task_id        TEXT PRIMARY KEY,
  case_id        UUID REFERENCES ens.case(case_id),
  tenant_id      TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('intake_exception','um_review','rfi_response')),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','cancelled')),
  payload        JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ens.task ENABLE ROW LEVEL SECURITY;
ALTER TABLE ens.task FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ens.task;
CREATE POLICY tenant_isolation ON ens.task
  USING (tenant_id = current_setting('sim.tenant_id', true));
