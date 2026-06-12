-- Control plane DB (no PHI; tenant metadata only)
CREATE SCHEMA IF NOT EXISTS ctrl;

CREATE TABLE ctrl.cell (
  cell_id       TEXT PRIMARY KEY,
  tier          TEXT NOT NULL CHECK (tier IN ('pooled','dedicated','enclave')),
  region        TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('active','draining','decommissioned')),
  capacity_max  INT NOT NULL DEFAULT 200,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ctrl.tenant (
  tenant_id          TEXT PRIMARY KEY,
  display            TEXT NOT NULL,
  tier               TEXT NOT NULL CHECK (tier IN ('pooled','dedicated','enclave')),
  cell_id            TEXT NOT NULL REFERENCES ctrl.cell(cell_id),
  status             TEXT NOT NULL CHECK (status IN ('provisioning','active','suspended','archived','decommissioned')),
  env_kind           TEXT NOT NULL CHECK (env_kind IN ('sandbox','uat','prod')),
  env_group          TEXT NOT NULL,
  baa_status         TEXT,
  dpa_status         TEXT,
  support_tier       TEXT NOT NULL DEFAULT 'standard',
  compliance_baseline TEXT NOT NULL CHECK (compliance_baseline IN ('MA','MEDICAID','COMMERCIAL','PUBLIC')),
  retention_policy   JSONB NOT NULL DEFAULT '{"years": 7}',
  go_live_date       DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ctrl.entitlement (
  tenant_id TEXT NOT NULL REFERENCES ctrl.tenant(tenant_id) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  value     JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, key)
);

-- No RLS on ctrl schema — it lives in the control-plane DB, never a cell DB.
-- ctrl tables are metadata only, protected by service-layer RBAC.
