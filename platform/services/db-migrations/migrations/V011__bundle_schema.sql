-- HUMAN_REVIEW: bundle_artifact links market bundles to versioned VKAS artifacts.
-- Starter bundle policies are inserted as status='draft' and must not be promoted
-- to 'active' without clinical and compliance review.

CREATE SCHEMA IF NOT EXISTS market;

CREATE TABLE market.bundle (
  bundle_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT NOT NULL,
  bundle_ref   TEXT NOT NULL,
  lob          TEXT NOT NULL CHECK (lob IN ('MA', 'Medicaid', 'Commercial')),
  name         TEXT NOT NULL DEFAULT '',
  source       TEXT,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  version      INT NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE market.bundle ENABLE ROW LEVEL SECURITY;
ALTER TABLE market.bundle FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON market.bundle
  USING (tenant_id = current_setting('sim.tenant_id', true));

CREATE UNIQUE INDEX market_bundle_ref_tenant_idx ON market.bundle (tenant_id, bundle_ref);

CREATE TABLE market.bundle_artifact (
  tenant_id    TEXT NOT NULL,
  bundle_ref   TEXT NOT NULL,
  artifact_ref TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'policy',
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, bundle_ref, artifact_ref)
);

ALTER TABLE market.bundle_artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE market.bundle_artifact FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON market.bundle_artifact
  USING (tenant_id = current_setting('sim.tenant_id', true));
