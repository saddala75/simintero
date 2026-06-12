-- Seed cells for sandbox environments.
-- These cells must exist before tenants can be provisioned.
INSERT INTO ctrl.cell (cell_id, tier, region, endpoint, status, capacity_max)
VALUES
  ('cell-pooled-us1', 'pooled', 'us-east-1', 'https://cell-pooled-us1.internal.simintero.io', 'active', 200),
  ('cell-pooled-us2', 'pooled', 'us-west-2', 'https://cell-pooled-us2.internal.simintero.io', 'active', 200)
ON CONFLICT (cell_id) DO NOTHING;
