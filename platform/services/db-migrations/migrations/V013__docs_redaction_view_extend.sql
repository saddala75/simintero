-- Extend docs.redaction_view for Presidio-based PHI redaction pipeline
ALTER TABLE docs.redaction_view
  ADD COLUMN IF NOT EXISTS redacted_text TEXT,
  ADD COLUMN IF NOT EXISTS redaction_map JSONB;

-- Relax legacy NOT NULL constraints that the new pipeline doesn't populate
ALTER TABLE docs.redaction_view
  ALTER COLUMN fields_to_redact DROP NOT NULL,
  ALTER COLUMN object_key       DROP NOT NULL;
