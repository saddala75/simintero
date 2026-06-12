-- Every cell DB starts with this schema
CREATE SCHEMA IF NOT EXISTS shared;

-- Outbox: written atomically with state changes, relayed to Kafka
CREATE TABLE shared.outbox (
  seq          BIGSERIAL PRIMARY KEY,
  event_id     TEXT NOT NULL UNIQUE,
  topic        TEXT NOT NULL,
  key          TEXT NOT NULL,
  envelope     JSONB NOT NULL,
  tenant_id    TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

ALTER TABLE shared.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shared.outbox
  USING (tenant_id = current_setting('sim.tenant_id', true));

-- Consumer deduplication: prevents double-processing of replayed events
CREATE TABLE shared.processed_events (
  consumer_group TEXT NOT NULL,
  event_id       TEXT NOT NULL,
  processed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_group, event_id)
);

-- Evidence fabric: clinical FHIR resources shared by all modules
CREATE SCHEMA IF NOT EXISTS fabric;

CREATE TABLE fabric.resource (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      TEXT NOT NULL,
  resource_type  TEXT NOT NULL,
  fhir_id        TEXT NOT NULL,
  version        INT NOT NULL DEFAULT 1,
  profile        TEXT,
  content        JSONB NOT NULL,
  provenance_ref TEXT,
  source         TEXT NOT NULL,
  last_updated   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, resource_type, fhir_id)
);

ALTER TABLE fabric.resource ENABLE ROW LEVEL SECURITY;
ALTER TABLE fabric.resource FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fabric.resource
  USING (tenant_id = current_setting('sim.tenant_id', true));

CREATE INDEX fabric_resource_member_idx ON fabric.resource (tenant_id, fhir_id)
  WHERE resource_type = 'Patient';
CREATE INDEX fabric_resource_type_idx ON fabric.resource USING GIN (content)
  WHERE resource_type IN ('Condition','Observation','MedicationStatement','Coverage');

-- Relay consumer index: find unpublished events efficiently
CREATE INDEX outbox_relay_idx ON shared.outbox (topic, created_at)
  WHERE published_at IS NULL;
