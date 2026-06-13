-- V007__search_schema.sql
CREATE SCHEMA IF NOT EXISTS search;

CREATE TABLE search.index_event (
  event_id    TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  entity_type TEXT NOT NULL,  -- 'case' | 'document' | 'gap' | 'measure_report'
  entity_id   TEXT NOT NULL,
  indexed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE search.index_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE search.index_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON search.index_event
  USING (tenant_id = current_setting('sim.tenant_id', true));
CREATE UNIQUE INDEX ON search.index_event (tenant_id, entity_type, entity_id);

CREATE TABLE search.search_log (
  log_id      TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  query_hash  TEXT NOT NULL,  -- SHA-256 of query text — no raw query stored (PHI risk)
  entity_types TEXT[] NOT NULL DEFAULT '{}',
  result_count INT NOT NULL DEFAULT 0,
  searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE search.search_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE search.search_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON search.search_log
  USING (tenant_id = current_setting('sim.tenant_id', true));
