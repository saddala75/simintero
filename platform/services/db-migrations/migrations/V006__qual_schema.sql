-- V006__qual_schema.sql
-- Qualitron quality intelligence schema
-- ADR-6: pure consumer of fabric — no new substrate

CREATE SCHEMA IF NOT EXISTS qual;

-- Measure execution log
CREATE TABLE qual.measure_run (
  run_id          TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  measure_ref     TEXT NOT NULL,
  measure_version TEXT NOT NULL,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE qual.measure_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE qual.measure_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qual.measure_run
  USING (tenant_id = current_setting('sim.tenant_id', true));

-- Per-member MeasureReport output + trace
CREATE TABLE qual.measure_report (
  report_id       TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  run_id          TEXT NOT NULL REFERENCES qual.measure_run(run_id),
  member_id       TEXT NOT NULL,
  measure_ref     TEXT NOT NULL,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  numerator       BOOLEAN NOT NULL,
  denominator     BOOLEAN NOT NULL,
  exclusion       BOOLEAN NOT NULL DEFAULT false,
  report          JSONB NOT NULL,
  evidence_refs   JSONB NOT NULL DEFAULT '[]',
  trace_ref       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE qual.measure_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE qual.measure_report FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qual.measure_report
  USING (tenant_id = current_setting('sim.tenant_id', true));
CREATE INDEX ON qual.measure_report (tenant_id, run_id);
CREATE INDEX ON qual.measure_report (tenant_id, member_id, measure_ref);

-- Quality gaps (DEQM gaps-in-care)
CREATE TABLE qual.gap (
  gap_id          TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  member_id       TEXT NOT NULL,
  measure_ref     TEXT NOT NULL,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  gap_type        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  closure_reason  TEXT
);
ALTER TABLE qual.gap ENABLE ROW LEVEL SECURITY;
ALTER TABLE qual.gap FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qual.gap
  USING (tenant_id = current_setting('sim.tenant_id', true));
CREATE INDEX ON qual.gap (tenant_id, member_id, status);

-- Link from gap to Task Service outreach task
CREATE TABLE qual.outreach_task_ref (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  gap_id     TEXT NOT NULL REFERENCES qual.gap(gap_id),
  task_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE qual.outreach_task_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE qual.outreach_task_ref FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qual.outreach_task_ref
  USING (tenant_id = current_setting('sim.tenant_id', true));
