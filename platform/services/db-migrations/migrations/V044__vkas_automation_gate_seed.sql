-- V044: seed automation gate policy into VKAS.
-- tenant_id='shared': readable by all tenants under the authz RLS policy.
-- status='active': seeded directly as active; changes go through normal VKAS lifecycle.
-- ON CONFLICT DO NOTHING: idempotent.

WITH policy AS (
  SELECT $${
    "min_confidence": 1.0,
    "description": "Minimum AI confidence score required for automation. Lower only after clinical safety review and VKAS approval lifecycle."
  }$$::jsonb AS content
)
INSERT INTO vkas.artifact (
  canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by
)
SELECT
  'urn:sim:policy:automation-gate',
  '1.0.0',
  'shared',
  'authz_policy',
  'active',
  content,
  md5(content::text),
  'seed'
FROM policy
ON CONFLICT (canonical_url, version) DO NOTHING;
