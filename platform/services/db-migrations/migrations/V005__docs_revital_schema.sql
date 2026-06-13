-- docs schema — Document Service tables
CREATE SCHEMA IF NOT EXISTS docs;

CREATE TABLE docs.document (
  doc_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT NOT NULL,
  case_ref          TEXT,
  doc_type          TEXT NOT NULL DEFAULT 'unknown',
  source_channel    TEXT NOT NULL CHECK (source_channel IN (
                      'fhir_document_reference','fhir_binary','x12_275','portal_upload','fax_ocr')),
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  object_key        TEXT NOT NULL,
  text_key          TEXT,
  classification    JSONB,
  retention_policy  JSONB NOT NULL DEFAULT '{"days":2555}',
  legal_hold        BOOLEAN NOT NULL DEFAULT false,
  virus_scan_status TEXT NOT NULL DEFAULT 'pending'
                      CHECK (virus_scan_status IN ('pending','clean','quarantined')),
  provenance_ref    TEXT,
  created_by        JSONB NOT NULL
);
ALTER TABLE docs.document ENABLE ROW LEVEL SECURITY;
ALTER TABLE docs.document FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON docs.document
  USING (tenant_id = current_setting('sim.tenant_id', true));

CREATE INDEX docs_document_case_idx ON docs.document (tenant_id, case_ref)
  WHERE case_ref IS NOT NULL;

CREATE TABLE docs.redaction_view (
  view_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT NOT NULL,
  doc_id           UUID NOT NULL REFERENCES docs.document(doc_id),
  fields_to_redact TEXT[] NOT NULL,
  object_key       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       JSONB NOT NULL
);
ALTER TABLE docs.redaction_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE docs.redaction_view FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON docs.redaction_view
  USING (tenant_id = current_setting('sim.tenant_id', true));

-- revital schema — Revital advisory tables
CREATE SCHEMA IF NOT EXISTS revital;

CREATE TABLE revital.analysis (
  analysis_id        TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  case_ref           TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('processing','complete','partial','failed')),
  interaction        JSONB NOT NULL,
  summary            JSONB,
  extraction         JSONB,
  completeness       JSONB,
  triage             JSONB,
  abstentions        JSONB NOT NULL DEFAULT '[]',
  unprocessed_inputs JSONB NOT NULL DEFAULT '[]',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ
);
ALTER TABLE revital.analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE revital.analysis FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON revital.analysis
  USING (tenant_id = current_setting('sim.tenant_id', true));

CREATE INDEX revital_analysis_case_idx ON revital.analysis (tenant_id, case_ref);

CREATE TABLE revital.feedback (
  feedback_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT NOT NULL,
  analysis_id  TEXT NOT NULL REFERENCES revital.analysis(analysis_id),
  actor        JSONB NOT NULL,
  items        JSONB NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE revital.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE revital.feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON revital.feedback
  USING (tenant_id = current_setting('sim.tenant_id', true));
