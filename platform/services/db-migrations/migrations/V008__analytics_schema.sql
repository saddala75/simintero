-- V008__analytics_schema.sql
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE analytics.margin_snapshot (
  snapshot_id   TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  revenue_usd   NUMERIC(12,4) NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(12,4) NOT NULL DEFAULT 0,
  margin_usd    NUMERIC(12,4) GENERATED ALWAYS AS (revenue_usd - cost_usd) STORED,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE analytics.margin_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.margin_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics.margin_snapshot
  USING (tenant_id = current_setting('sim.tenant_id', true));
CREATE INDEX ON analytics.margin_snapshot (tenant_id, period_start, period_end);

-- No tenant_id — intentionally de-identified cross-tenant aggregate
-- HUMAN_REVIEW: de-identification approach requires Safe Harbor or expert determination review
CREATE TABLE analytics.platform_aggregate (
  aggregate_id    TEXT PRIMARY KEY,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  tenant_count    INT NOT NULL,
  case_count      INT NOT NULL,
  gap_count       INT NOT NULL,
  total_cost_usd  NUMERIC(12,4) NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
