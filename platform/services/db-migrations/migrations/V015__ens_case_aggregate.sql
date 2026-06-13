-- V015: Enstellar case aggregate — determination and RFI tables, case_event evolution
-- Migrated from modules/enstellar/case/src/db/migrations/V006__ens_case_events.sql

-- 1. Evolve ens.case_event — add missing Phase 1 columns
ALTER TABLE ens.case_event
  ADD COLUMN IF NOT EXISTS event_id   TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  ADD COLUMN IF NOT EXISTS schema_ref TEXT;

-- 2. Append-only trigger on ens.case_event
CREATE OR REPLACE FUNCTION ens.prevent_case_event_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ens.case_event is append-only';
END;
$$;

DROP TRIGGER IF EXISTS enforce_case_event_append_only ON ens.case_event;
CREATE TRIGGER enforce_case_event_append_only
  BEFORE UPDATE OR DELETE ON ens.case_event
  FOR EACH ROW EXECUTE FUNCTION ens.prevent_case_event_mutation();

-- 3. Create ens.determination
CREATE TABLE IF NOT EXISTS ens.determination (
  determination_id      TEXT PRIMARY KEY,
  case_id               UUID NOT NULL REFERENCES ens.case(case_id),
  tenant_id             TEXT NOT NULL,
  outcome               TEXT NOT NULL CHECK (outcome IN ('approved','partially_approved','denied','modified')),
  per_line              JSONB NOT NULL DEFAULT '[]',
  decided_by            JSONB NOT NULL,
  auto_path             BOOLEAN NOT NULL DEFAULT false,
  rationale_ref         TEXT,
  rules_trace_ref       TEXT,
  advisory_analysis_ref TEXT,
  pins                  JSONB NOT NULL DEFAULT '[]',
  decided_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  supersedes            TEXT
);
ALTER TABLE ens.determination ENABLE ROW LEVEL SECURITY;
ALTER TABLE ens.determination FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ens.determination;
CREATE POLICY tenant_isolation ON ens.determination
  USING (tenant_id = current_setting('sim.tenant_id', true));
DO $$
BEGIN
  ALTER TABLE ens.determination
    ADD CONSTRAINT adverse_outcome_requires_human
    CHECK (
      outcome NOT IN ('denied','modified')
      OR (decided_by->>'type' = 'human' AND rationale_ref IS NOT NULL AND rules_trace_ref IS NOT NULL)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- 4. Create ens.rfi
CREATE TABLE IF NOT EXISTS ens.rfi (
  rfi_id          TEXT PRIMARY KEY,
  case_id         UUID NOT NULL REFERENCES ens.case(case_id),
  tenant_id       TEXT NOT NULL,
  requirement_ids JSONB NOT NULL DEFAULT '[]',
  channel         TEXT NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL,
  due_by          TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('open','satisfied','expired')),
  satisfied_by    JSONB NOT NULL DEFAULT '[]'
);
ALTER TABLE ens.rfi ENABLE ROW LEVEL SECURITY;
ALTER TABLE ens.rfi FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ens.rfi;
CREATE POLICY tenant_isolation ON ens.rfi
  USING (tenant_id = current_setting('sim.tenant_id', true));
