-- V033: Add advisory_type to revital.analysis to distinguish PA vs claims-attachment advisories
ALTER TABLE revital.analysis
  ADD COLUMN advisory_type TEXT NOT NULL DEFAULT 'pa'
    CHECK (advisory_type IN ('pa', 'claims_attachment'));

CREATE INDEX revital_analysis_advisory_type_idx ON revital.analysis (tenant_id, advisory_type, case_ref);
