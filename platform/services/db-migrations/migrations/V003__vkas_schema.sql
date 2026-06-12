CREATE SCHEMA IF NOT EXISTS vkas;

CREATE TABLE vkas.artifact (
  canonical_url   TEXT NOT NULL,
  version         TEXT NOT NULL,
  tenant_id       TEXT NOT NULL,
  artifact_type   TEXT NOT NULL CHECK (artifact_type IN (
    'coverage_rule','cql_library','dtr_package','crd_rule','value_set','concept_map',
    'workflow_def','clock_profile','measure','prompt','model_binding','template','authz_policy'
  )),
  status          TEXT NOT NULL CHECK (status IN ('draft','in_review','approved','active','retired','superseded')),
  effective_from  DATE,
  effective_to    DATE,
  content         JSONB NOT NULL,
  content_hash    TEXT NOT NULL,
  applicability   JSONB NOT NULL DEFAULT '{}',
  relations       JSONB NOT NULL DEFAULT '[]',
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (canonical_url, version)
);

ALTER TABLE vkas.artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE vkas.artifact FORCE ROW LEVEL SECURITY;
-- shared tenant_id allows platform-wide artifacts readable by all tenants
CREATE POLICY tenant_isolation ON vkas.artifact
  USING (tenant_id = current_setting('sim.tenant_id', true) OR tenant_id = 'shared');

-- Immutability: prevent modification of approved/active/retired/superseded artifacts
CREATE OR REPLACE FUNCTION vkas.enforce_immutability() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('approved','active','retired','superseded') THEN
    -- Block content mutations on any locked artifact
    IF NEW.content IS DISTINCT FROM OLD.content OR
       NEW.content_hash IS DISTINCT FROM OLD.content_hash OR
       NEW.relations IS DISTINCT FROM OLD.relations THEN
      RAISE EXCEPTION 'Cannot modify content of artifact in status %: canonical_url=%, version=%',
        OLD.status, OLD.canonical_url, OLD.version;
    END IF;
    -- Only allow status transitions to terminal states
    IF NEW.status NOT IN ('retired','superseded') THEN
      RAISE EXCEPTION 'Cannot change status of artifact from % to %: only retired/superseded allowed',
        OLD.status, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vkas_artifact_immutable
  BEFORE UPDATE ON vkas.artifact
  FOR EACH ROW EXECUTE FUNCTION vkas.enforce_immutability();

CREATE TABLE vkas.approval (
  canonical_url TEXT NOT NULL,
  version       TEXT NOT NULL,
  gate          TEXT NOT NULL CHECK (gate IN ('clinical','compliance','eval','impact')),
  approver      TEXT NOT NULL,
  decided       TEXT NOT NULL CHECK (decided IN ('approved','rejected')),
  rationale     TEXT,
  attestation   JSONB,
  decided_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (canonical_url, version, gate)
);

CREATE INDEX vkas_artifact_type_status ON vkas.artifact (artifact_type, status, tenant_id);
CREATE INDEX vkas_artifact_effective ON vkas.artifact (tenant_id, artifact_type, effective_from, effective_to);
