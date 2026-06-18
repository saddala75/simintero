-- Seed the shared model_binding the Revital inference path resolves
-- (modules/revital/pipeline/src/routes/analyses.ts DEFAULT_MODEL_BINDING).
-- endpoint_overrides.pooled points at the deterministic mock-llm (Anthropic Messages shape).
INSERT INTO vkas.artifact
  (canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by)
VALUES (
  'https://artifacts.simintero.io/shared/model_binding/claude-pa',
  '1.0.0',
  'shared',
  'model_binding',
  'active',
  '{"provider":"anthropic","model_id":"claude-sonnet-4-6","endpoint_overrides":{"pooled":"http://mock-llm:3060"},"adapter_config":{"max_tokens":1024},"no_train_enforced":true}'::jsonb,
  'seed-ai1',
  'ai1-seed'
)
ON CONFLICT (canonical_url, version) DO NOTHING;
