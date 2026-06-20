-- V025: durable Digicore governance approval store (replaces the in-memory Map).
-- header (one mutable row per coverage_rule) + append-only approval ledger.
CREATE SCHEMA IF NOT EXISTS governance;

CREATE TABLE governance.artifact (
  artifact_id     TEXT PRIMARY KEY,                      -- coverage_rule canonical_url
  tenant_id       TEXT NOT NULL DEFAULT 'shared',
  created_by      TEXT NOT NULL,                         -- author (SoD)
  cql_library_url TEXT,
  version         TEXT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at    TIMESTAMPTZ
);
ALTER TABLE governance.artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.artifact FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON governance.artifact
  USING (tenant_id = current_setting('sim.tenant_id', true) OR tenant_id = 'shared');

CREATE TABLE governance.approval (
  id          BIGSERIAL PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES governance.artifact(artifact_id),
  tenant_id   TEXT NOT NULL DEFAULT 'shared',
  gate        TEXT NOT NULL CHECK (gate IN ('clinical','compliance')),
  approver    TEXT NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE governance.approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.approval FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON governance.approval
  USING (tenant_id = current_setting('sim.tenant_id', true) OR tenant_id = 'shared');
CREATE INDEX governance_approval_artifact_idx ON governance.approval (artifact_id, recorded_at, id);

-- sim_app grants (governance is NOT covered by V023's ALTER DEFAULT PRIVILEGES schema list).
-- UPDATE granted (artifact.activated_at); DELETE intentionally NOT granted (append-only audit).
GRANT USAGE ON SCHEMA governance TO sim_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA governance TO sim_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA governance TO sim_app;
