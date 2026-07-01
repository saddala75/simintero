-- V043: seed DTR questionnaire artifact into VKAS for knee-arthroscopy prior authorization.
-- tenant_id='shared' so it is readable by all tenants under the vkas.artifact RLS policy:
--   USING (tenant_id = current_setting('sim.tenant_id', true) OR tenant_id = 'shared')
-- Inserted directly as 'active' — seed data bypasses the normal draft→approved→active gate.
-- ON CONFLICT DO NOTHING makes the migration idempotent.

WITH questionnaire AS (
  SELECT $${
    "resourceType": "Questionnaire",
    "id": "knee-arthroscopy-dtr",
    "version": "1.0.0",
    "name": "KneeArthroscopyDTR",
    "title": "Knee Arthroscopy – Documentation Template and Rules",
    "status": "active",
    "description": "Prior authorization documentation requirements for knee arthroscopy procedures.",
    "item": [
      {
        "linkId": "diagnosis_documented",
        "text": "Is the diagnosis of a knee condition documented in the medical record?",
        "type": "boolean",
        "required": true
      },
      {
        "linkId": "conservative_therapy_tried",
        "text": "Has the patient attempted conservative therapy (e.g., PT, NSAIDs) for at least 6 weeks?",
        "type": "boolean",
        "required": true
      },
      {
        "linkId": "imaging_documented",
        "text": "Is imaging (X-ray or MRI) documenting the knee condition available?",
        "type": "boolean",
        "required": true
      }
    ]
  }$$::jsonb AS content
)
INSERT INTO vkas.artifact (
  canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by
)
SELECT
  'urn:sim:dtr:knee-arthroscopy:1.0.0',
  '1.0.0',
  'shared',
  'dtr_package',
  'active',
  content,
  md5(content::text),
  'seed'
FROM questionnaire
ON CONFLICT (canonical_url, version) DO NOTHING;
