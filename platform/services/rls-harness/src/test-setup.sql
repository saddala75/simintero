-- Run as superuser to bypass RLS and insert sentinel rows for both test tenants.
-- These rows are used by the harness to verify cross-tenant isolation (NEGATIVE check)
-- and own-tenant visibility (POSITIVE check) under SET ROLE sim_app.
--
-- One sentinel row per tenant (t_synth_a / t_synth_b) for every one of the 28 RLS
-- tables. Parent rows are seeded before children so FK constraints are satisfied.
-- All inserts use ON CONFLICT DO NOTHING so repeated runs are idempotent.

-- ===========================================================================
-- shared.outbox
-- ===========================================================================
INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
VALUES
  ('evt_RLS_SENTINEL_A_OUTBOX', 'sim.case.lifecycle', 'case_sentinel_a', '{}', 't_synth_a'),
  ('evt_RLS_SENTINEL_B_OUTBOX', 'sim.case.lifecycle', 'case_sentinel_b', '{}', 't_synth_b')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- fabric.resource  (provenance_ref is NOT NULL after V014)
-- ===========================================================================
INSERT INTO fabric.resource (tenant_id, resource_type, fhir_id, content, source, provenance_ref)
VALUES
  ('t_synth_a', 'Patient', 'pat-sentinel-a', '{"resourceType":"Patient"}', 'test', 'test:sentinel-a'),
  ('t_synth_b', 'Patient', 'pat-sentinel-b', '{"resourceType":"Patient"}', 'test', 'test:sentinel-b')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- vkas.artifact  (per-tenant sentinels + an explicit shared-visibility row)
-- ===========================================================================
INSERT INTO vkas.artifact (canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by)
VALUES
  ('https://artifacts.simintero.io/test/rls-sentinel', '1.0.0', 't_synth_a', 'coverage_rule', 'draft', '{}', 'hash_a', 'test'),
  ('https://artifacts.simintero.io/test/rls-sentinel', '2.0.0', 't_synth_b', 'coverage_rule', 'draft', '{}', 'hash_b', 'test'),
  ('https://artifacts.simintero.io/test/rls-sentinel-shared', '1.0.0', 'shared', 'coverage_rule', 'active', '{}', 'hash_shared', 'test')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- ens.case  (parent for claims.claim, claims.appeal)
-- NOTE: the ens child tables case_event/case_pin/determination/rfi/
-- service_line/task were created in V004/V014/V015 but DROPPED in V016
-- and never recreated, so they are not RLS tables in the current schema
-- and are intentionally omitted.
-- ===========================================================================
INSERT INTO ens.case (case_id, tenant_id, lob, state, urgency, channel)
VALUES
  ('00000000-0000-0000-0000-000000000001', 't_synth_a', 'MA', 'intake', 'standard', 'PAS'),
  ('00000000-0000-0000-0000-000000000002', 't_synth_b', 'MA', 'intake', 'standard', 'PAS')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- docs.document  (parent for docs.redaction_view)
-- ===========================================================================
INSERT INTO docs.document (doc_id, tenant_id, source_channel, object_key, created_by)
VALUES
  ('00000000-0000-0000-0000-0000000000d1', 't_synth_a', 'portal_upload', 'obj/sentinel-a', '{"type":"system"}'),
  ('00000000-0000-0000-0000-0000000000d2', 't_synth_b', 'portal_upload', 'obj/sentinel-b', '{"type":"system"}')
ON CONFLICT DO NOTHING;

-- docs.redaction_view  (fields_to_redact / object_key relaxed to NULL in V013)
INSERT INTO docs.redaction_view (tenant_id, doc_id, created_by)
VALUES
  ('t_synth_a', '00000000-0000-0000-0000-0000000000d1', '{"type":"system"}'),
  ('t_synth_b', '00000000-0000-0000-0000-0000000000d2', '{"type":"system"}')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- revital.analysis  (parent for revital.feedback)
-- ===========================================================================
INSERT INTO revital.analysis (analysis_id, tenant_id, case_ref, status, interaction)
VALUES
  ('analysis_sentinel_a', 't_synth_a', 'case_ref_a', 'complete', '{}'),
  ('analysis_sentinel_b', 't_synth_b', 'case_ref_b', 'complete', '{}')
ON CONFLICT DO NOTHING;

-- revital.feedback
INSERT INTO revital.feedback (tenant_id, analysis_id, actor, items)
VALUES
  ('t_synth_a', 'analysis_sentinel_a', '{"type":"system"}', '[]'),
  ('t_synth_b', 'analysis_sentinel_b', '{"type":"system"}', '[]')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- qual.measure_definition
-- ===========================================================================
INSERT INTO qual.measure_definition (measure_ref, version, tenant_id, title, spec)
VALUES
  ('sentinel:measure', '1.0.0-a', 't_synth_a', 'Sentinel Measure A', '{}'),
  ('sentinel:measure', '1.0.0-b', 't_synth_b', 'Sentinel Measure B', '{}')
ON CONFLICT DO NOTHING;

-- qual.measure_run  (parent for qual.measure_report)
INSERT INTO qual.measure_run (run_id, tenant_id, measure_ref, measure_version, period_start, period_end)
VALUES
  ('run_sentinel_a', 't_synth_a', 'sentinel:measure', '1.0.0-a', '2026-01-01', '2026-12-31'),
  ('run_sentinel_b', 't_synth_b', 'sentinel:measure', '1.0.0-b', '2026-01-01', '2026-12-31')
ON CONFLICT DO NOTHING;

-- qual.measure_report
INSERT INTO qual.measure_report (report_id, tenant_id, run_id, member_id, measure_ref, period_start, period_end, numerator, denominator, report)
VALUES
  ('report_sentinel_a', 't_synth_a', 'run_sentinel_a', 'member_a', 'sentinel:measure', '2026-01-01', '2026-12-31', true, true, '{}'),
  ('report_sentinel_b', 't_synth_b', 'run_sentinel_b', 'member_b', 'sentinel:measure', '2026-01-01', '2026-12-31', true, true, '{}')
ON CONFLICT DO NOTHING;

-- qual.gap  (parent for qual.outreach_task_ref)
INSERT INTO qual.gap (gap_id, tenant_id, member_id, measure_ref, period_start, period_end, gap_type)
VALUES
  ('gap_sentinel_a', 't_synth_a', 'member_a', 'sentinel:measure', '2026-01-01', '2026-12-31', 'open_gap'),
  ('gap_sentinel_b', 't_synth_b', 'member_b', 'sentinel:measure', '2026-01-01', '2026-12-31', 'open_gap')
ON CONFLICT DO NOTHING;

-- qual.outreach_task_ref
INSERT INTO qual.outreach_task_ref (id, tenant_id, gap_id, task_id)
VALUES
  ('otr_sentinel_a', 't_synth_a', 'gap_sentinel_a', 'task_a'),
  ('otr_sentinel_b', 't_synth_b', 'gap_sentinel_b', 'task_b')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- search.index_event
-- ===========================================================================
INSERT INTO search.index_event (event_id, tenant_id, entity_type, entity_id)
VALUES
  ('idx_sentinel_a', 't_synth_a', 'case', 'entity_a'),
  ('idx_sentinel_b', 't_synth_b', 'case', 'entity_b')
ON CONFLICT DO NOTHING;

-- search.search_log
INSERT INTO search.search_log (log_id, tenant_id, query_hash)
VALUES
  ('log_sentinel_a', 't_synth_a', 'hash_a'),
  ('log_sentinel_b', 't_synth_b', 'hash_b')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- analytics.margin_snapshot
-- ===========================================================================
INSERT INTO analytics.margin_snapshot (snapshot_id, tenant_id, period_start, period_end)
VALUES
  ('snap_sentinel_a', 't_synth_a', '2026-01-01', '2026-12-31'),
  ('snap_sentinel_b', 't_synth_b', '2026-01-01', '2026-12-31')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- claims.claim
-- ===========================================================================
INSERT INTO claims.claim (claim_id, tenant_id, case_id, claim_number, service_date_start, service_date_end)
VALUES
  ('claim_sentinel_a', 't_synth_a', '00000000-0000-0000-0000-000000000001', 'CLM-A', '2026-01-01', '2026-01-02'),
  ('claim_sentinel_b', 't_synth_b', '00000000-0000-0000-0000-000000000002', 'CLM-B', '2026-01-01', '2026-01-02')
ON CONFLICT DO NOTHING;

-- claims.appeal
INSERT INTO claims.appeal (appeal_id, tenant_id, appeal_case_id, original_case_id, appeal_type)
VALUES
  ('appeal_sentinel_a', 't_synth_a', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'standard'),
  ('appeal_sentinel_b', 't_synth_b', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'standard')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- automation.disposition_log
-- ===========================================================================
INSERT INTO automation.disposition_log (disposition_id, tenant_id, case_ref, analysis_id, proposed_outcome, allow, system_user_id)
VALUES
  ('disp_sentinel_a', 't_synth_a', 'case_ref_a', 'analysis_sentinel_a', 'approved', true, 'system'),
  ('disp_sentinel_b', 't_synth_b', 'case_ref_b', 'analysis_sentinel_b', 'approved', true, 'system')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- market.bundle
-- ===========================================================================
INSERT INTO market.bundle (tenant_id, bundle_ref, lob)
VALUES
  ('t_synth_a', 'bundle_a', 'MA'),
  ('t_synth_b', 'bundle_b', 'MA')
ON CONFLICT DO NOTHING;

-- market.bundle_artifact
INSERT INTO market.bundle_artifact (tenant_id, bundle_ref, artifact_ref)
VALUES
  ('t_synth_a', 'bundle_a', 'artifact_a'),
  ('t_synth_b', 'bundle_b', 'artifact_b')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- task.task
-- ===========================================================================
INSERT INTO task.task (task_id, tenant_id, task_kind)
VALUES
  ('task_sentinel_a', 't_synth_a', 'outreach'),
  ('task_sentinel_b', 't_synth_b', 'outreach')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- governance.artifact  (parent for governance.approval)
-- ===========================================================================
INSERT INTO governance.artifact (artifact_id, tenant_id, created_by)
VALUES
  ('gov_a', 't_synth_a', 'author-a'),
  ('gov_b', 't_synth_b', 'author-b')
ON CONFLICT DO NOTHING;

-- governance.approval  (FK -> governance.artifact.artifact_id)
INSERT INTO governance.approval (artifact_id, tenant_id, gate, approver, decision)
VALUES
  ('gov_a', 't_synth_a', 'clinical', 'rev-a', 'approved'),
  ('gov_b', 't_synth_b', 'clinical', 'rev-b', 'approved')
ON CONFLICT DO NOTHING;
