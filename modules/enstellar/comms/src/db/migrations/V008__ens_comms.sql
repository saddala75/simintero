CREATE TABLE IF NOT EXISTS ens.communication (
  comm_id       TEXT PRIMARY KEY,
  case_id       UUID NOT NULL,     -- UUID (Phase 0 PK type), NOT TEXT
  tenant_id     TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('rfi','determination_letter','status','p2p_invite')),
  template_pin  JSONB NOT NULL,    -- {canonical_url, version}
  recipient     JSONB NOT NULL,    -- {fhir_ref, name, address, channel_prefs}
  channel       TEXT NOT NULL,
  regulatory_content_profile TEXT NOT NULL,
  sent_at       TIMESTAMPTZ,
  delivery_status TEXT NOT NULL DEFAULT 'queued'
    CHECK (delivery_status IN ('queued','sent','delivered','failed'))
);
ALTER TABLE ens.communication ENABLE ROW LEVEL SECURITY;
ALTER TABLE ens.communication FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ens.communication;
CREATE POLICY tenant_isolation ON ens.communication
  USING (tenant_id = current_setting('sim.tenant_id', true));
CREATE INDEX IF NOT EXISTS idx_ens_comm_case_id ON ens.communication (case_id);
