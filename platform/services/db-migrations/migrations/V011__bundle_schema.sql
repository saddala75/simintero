-- HUMAN_REVIEW: bundle_artifact links market bundles to versioned VKAS artifacts.
-- Starter bundle policies are inserted as status='draft' and must not be promoted
-- to 'active' without clinical and compliance review.

CREATE SCHEMA IF NOT EXISTS market;

CREATE TABLE market.bundle (
  bundle_id    TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  bundle_ref   TEXT NOT NULL,
  lob          TEXT NOT NULL CHECK (lob IN ('MA', 'Medicaid', 'Commercial')),
  name         TEXT NOT NULL,
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
  bundle_id    TEXT NOT NULL REFERENCES market.bundle(bundle_id),
  artifact_id  TEXT NOT NULL REFERENCES vkas.artifact(artifact_id),
  tenant_id    TEXT NOT NULL,
  artifact_role TEXT NOT NULL DEFAULT 'policy',
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bundle_id, artifact_id)
);

ALTER TABLE market.bundle_artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE market.bundle_artifact FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON market.bundle_artifact
  USING (tenant_id = current_setting('sim.tenant_id', true));
