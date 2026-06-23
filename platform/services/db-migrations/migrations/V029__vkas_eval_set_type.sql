-- V029: add 'eval_set' artifact type (slice 2.2b — the eval/model-ops gate's gold sets).
ALTER TABLE vkas.artifact DROP CONSTRAINT IF EXISTS artifact_artifact_type_check;
ALTER TABLE vkas.artifact ADD CONSTRAINT artifact_artifact_type_check
  CHECK (artifact_type IN (
    'coverage_rule','cql_library','dtr_package','crd_rule','value_set','concept_map',
    'workflow_def','clock_profile','measure','prompt','model_binding','template','authz_policy',
    'eval_set'
  ));
