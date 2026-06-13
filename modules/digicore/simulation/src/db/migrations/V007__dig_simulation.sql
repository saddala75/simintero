CREATE TABLE IF NOT EXISTS dig.simulation_run (
  run_id         TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  artifact_version_pins JSONB NOT NULL,
  triggered_by   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ
);
ALTER TABLE dig.simulation_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE dig.simulation_run FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dig.simulation_run;
CREATE POLICY tenant_isolation ON dig.simulation_run
  USING (tenant_id = current_setting('sim.tenant_id', true));

CREATE TABLE IF NOT EXISTS dig.simulation_result (
  result_id      TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES dig.simulation_run(run_id),
  tenant_id      TEXT NOT NULL,
  test_case_id   TEXT NOT NULL,
  expected_outcome TEXT NOT NULL,
  actual_outcome   TEXT NOT NULL,
  passed         BOOLEAN NOT NULL GENERATED ALWAYS AS (expected_outcome = actual_outcome) STORED,
  trace_ref      TEXT NOT NULL
);
ALTER TABLE dig.simulation_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE dig.simulation_result FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dig.simulation_result;
CREATE POLICY tenant_isolation ON dig.simulation_result
  USING (tenant_id = current_setting('sim.tenant_id', true));
