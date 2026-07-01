-- qual.measure_activation: per-tenant measure library activation.
-- Presence of a row = active; absence = inactive.
CREATE TABLE qual.measure_activation (
  tenant_id    TEXT        NOT NULL,
  measure_ref  TEXT        NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, measure_ref)
);
ALTER TABLE qual.measure_activation ENABLE ROW LEVEL SECURITY;
ALTER TABLE qual.measure_activation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON qual.measure_activation;
CREATE POLICY tenant_isolation ON qual.measure_activation
  USING (tenant_id = current_setting('sim.tenant_id', true));
-- Seed the same default-active set used in the Python fallback
INSERT INTO qual.measure_activation (tenant_id, measure_ref)
VALUES
  ('tenant-dev', 'hedis-col'),
  ('tenant-dev', 'hedis-cbp'),
  ('tenant-dev', 'hedis-aab'),
  ('tenant-dev', 'stars-d12'),
  ('tenant-dev', 'qrs-bcs')
ON CONFLICT DO NOTHING;
