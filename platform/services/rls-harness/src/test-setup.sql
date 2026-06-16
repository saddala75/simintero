-- Run as superuser to bypass RLS and insert sentinel rows for both test tenants
-- These rows are used by the harness to verify cross-tenant isolation

-- shared.outbox
INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
VALUES
  ('evt_RLS_SENTINEL_A_OUTBOX', 'sim.case.lifecycle', 'case_sentinel_a', '{}', 't_synth_a'),
  ('evt_RLS_SENTINEL_B_OUTBOX', 'sim.case.lifecycle', 'case_sentinel_b', '{}', 't_synth_b')
ON CONFLICT DO NOTHING;

-- fabric.resource
INSERT INTO fabric.resource (tenant_id, resource_type, fhir_id, content, source)
VALUES
  ('t_synth_a', 'Patient', 'pat-sentinel-a', '{"resourceType":"Patient"}', 'test'),
  ('t_synth_b', 'Patient', 'pat-sentinel-b', '{"resourceType":"Patient"}', 'test')
ON CONFLICT DO NOTHING;

-- vkas.artifact (use shared tenant_id so it appears for both, then add a tenant-specific one)
INSERT INTO vkas.artifact (canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by)
VALUES
  ('https://artifacts.simintero.io/test/rls-sentinel', '1.0.0', 't_synth_a', 'coverage_rule', 'draft', '{}', 'hash_a', 'test'),
  ('https://artifacts.simintero.io/test/rls-sentinel', '2.0.0', 't_synth_b', 'coverage_rule', 'draft', '{}', 'hash_b', 'test')
ON CONFLICT DO NOTHING;

-- ens.case
INSERT INTO ens.case (case_id, tenant_id, lob, state, urgency, channel)
VALUES
  ('00000000-0000-0000-0000-000000000001', 't_synth_a', 'MA', 'intake', 'standard', 'PAS'),
  ('00000000-0000-0000-0000-000000000002', 't_synth_b', 'MA', 'intake', 'standard', 'PAS')
ON CONFLICT DO NOTHING;
