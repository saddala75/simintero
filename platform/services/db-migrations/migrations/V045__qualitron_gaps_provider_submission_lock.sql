-- V045: add provider_id to qual.gap; create qual.submission_lock with RLS

ALTER TABLE qual.gap
  ADD COLUMN IF NOT EXISTS provider_id TEXT;

CREATE TABLE IF NOT EXISTS qual.submission_lock (
  lock_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  TEXT        NOT NULL,
  package_id TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  locked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by  TEXT
);

ALTER TABLE qual.submission_lock ENABLE ROW LEVEL SECURITY;
ALTER TABLE qual.submission_lock FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qual.submission_lock
  USING (tenant_id = current_setting('sim.tenant_id', true));
