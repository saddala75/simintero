-- V039: seed VKAS model_binding and prompt artifacts required by Revital inference (P3.5).
-- Both artifacts are tenant_id='shared' so they are readable by all tenants under
-- the vkas.artifact RLS policy:
--   USING (tenant_id = current_setting('sim.tenant_id', true) OR tenant_id = 'shared')
-- Inserted directly as 'active' — the normal API flow requires eval gate approval for
-- model_binding and prompt types, but seed data bypasses this for dev environments.
-- ON CONFLICT DO NOTHING makes the migration idempotent.

-- claude-pa model binding ─────────────────────────────────────────────────────────────
WITH binding AS (
  SELECT jsonb_build_object(
    'provider',           'anthropic',
    'model_id',           'claude-sonnet-4-6',
    'endpoint_overrides', jsonb_build_object(
      'pooled',    'https://api.anthropic.com/v1/messages',
      'dedicated', 'https://api.anthropic.com/v1/messages'
    ),
    'adapter_config',     jsonb_build_object(
      'max_tokens',   4096,
      'temperature',  0.0
    ),
    'no_train_enforced', true
  ) AS content
)
INSERT INTO vkas.artifact (
  canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by
)
SELECT
  'https://artifacts.simintero.io/shared/model_binding/claude-pa',
  '1.0.0',
  'shared',
  'model_binding',
  'active',
  content,
  md5(content::text),
  'seed'
FROM binding
ON CONFLICT (canonical_url, version) DO NOTHING;

-- pa-review prompt ────────────────────────────────────────────────────────────────────
WITH prompt AS (
  SELECT jsonb_build_object(
    'system_prompt', 'You are a clinical prior-authorization reviewer assistant. '
      || 'Analyze the provided clinical documentation and coverage criteria, then: '
      || '(1) assess completeness of submitted clinical evidence against requirements, '
      || '(2) identify any gaps or missing information, '
      || '(3) provide a triage recommendation (likely_meets, likely_does_not_meet, or needs_more_info) '
      || 'with a confidence score between 0 and 1. '
      || 'Always cite the specific document spans that support your assertions. '
      || 'This is an advisory output only — final determination is made by a licensed clinician.',
    'version',       '1.0.0',
    'task_kinds',    jsonb_build_array('extract_entities', 'summarize', 'triage_advise')
  ) AS content
)
INSERT INTO vkas.artifact (
  canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by
)
SELECT
  'https://artifacts.simintero.io/shared/prompt/pa-review',
  '1.0.0',
  'shared',
  'prompt',
  'active',
  content,
  md5(content::text),
  'seed'
FROM prompt
ON CONFLICT (canonical_url, version) DO NOTHING;
