CREATE SCHEMA IF NOT EXISTS dig;

CREATE TABLE IF NOT EXISTS dig.artifact_cache (
  cache_key     TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL,
  version       TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  tenant_id     TEXT NOT NULL,
  resolved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_ref   TEXT NOT NULL
);
ALTER TABLE dig.artifact_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE dig.artifact_cache FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dig.artifact_cache;
CREATE POLICY tenant_isolation ON dig.artifact_cache
  USING (tenant_id = current_setting('sim.tenant_id', true));
