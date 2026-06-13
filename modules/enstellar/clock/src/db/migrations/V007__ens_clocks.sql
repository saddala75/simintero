CREATE TABLE IF NOT EXISTS ens.clock (
  clock_id        TEXT PRIMARY KEY,
  case_id         UUID NOT NULL,   -- UUID (Phase 0 ens.case PK type), NOT TEXT
  tenant_id       TEXT NOT NULL,
  profile_pin     JSONB NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('standard','expedited','rfi_hold','appeal')),
  started_at      TIMESTAMPTZ NOT NULL,
  limit_value     JSONB NOT NULL,  -- {value, unit: 'business_days' | 'hours' | 'calendar_days'}
  elapsed_banked  INTERVAL NOT NULL DEFAULT '0',
  state           TEXT NOT NULL DEFAULT 'running'
    CHECK (state IN ('running','paused','satisfied','breached')),
  pause_history   JSONB NOT NULL DEFAULT '[]'
);
ALTER TABLE ens.clock ENABLE ROW LEVEL SECURITY;
ALTER TABLE ens.clock FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ens.clock;
CREATE POLICY tenant_isolation ON ens.clock
  USING (tenant_id = current_setting('sim.tenant_id', true));
CREATE INDEX IF NOT EXISTS idx_ens_clock_case_id ON ens.clock (case_id);
