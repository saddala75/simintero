-- V031: structured page/span provenance for ingested documents (slice 2.3a).
-- docs schema is covered by V023's ALTER DEFAULT PRIVILEGES (SELECT, INSERT, UPDATE, DELETE
-- on ALL future tables in schema docs granted to sim_app automatically).
CREATE TABLE docs.document_span (
  span_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id       UUID NOT NULL REFERENCES docs.document(doc_id) ON DELETE CASCADE,
  tenant_id    TEXT NOT NULL,
  seq          INT NOT NULL,
  page         INT NOT NULL,
  region       JSONB NOT NULL,
  text         TEXT NOT NULL,
  excerpt_hash TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doc_id, seq)
);
CREATE INDEX docs_document_span_doc_idx ON docs.document_span (tenant_id, doc_id, seq);
ALTER TABLE docs.document_span ENABLE ROW LEVEL SECURITY;
ALTER TABLE docs.document_span FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON docs.document_span
  USING (tenant_id = current_setting('sim.tenant_id', true));
-- sim_app privileges: docs schema is in V023's ALTER DEFAULT PRIVILEGES list, so
-- SELECT, INSERT, UPDATE, DELETE on this table are granted automatically.
-- Explicit grant mirrors V023's per-table pattern for clarity:
GRANT SELECT, INSERT, UPDATE, DELETE ON docs.document_span TO sim_app;
