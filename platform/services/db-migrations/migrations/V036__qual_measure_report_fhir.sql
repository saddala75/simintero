-- Add report_fhir and report_type columns to qual.measure_report
-- report_fhir: serialized FHIR MeasureReport JSON (null until Task 4 writes it)
-- report_type: 'individual' (default) or 'summary'
ALTER TABLE qual.measure_report
  ADD COLUMN report_fhir   JSONB,
  ADD COLUMN report_type   TEXT NOT NULL DEFAULT 'individual'
    CHECK (report_type IN ('individual', 'summary'));

-- Index for efficient filtering by report_type
CREATE INDEX qual_measure_report_type_idx
  ON qual.measure_report (tenant_id, run_id, report_type);
