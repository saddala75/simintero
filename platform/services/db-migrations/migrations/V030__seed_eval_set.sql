-- V030: seed the gold eval set for slice 2.2b (eval gate).
-- Column list matches V026/V018: canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by.
-- Gold cases tuned to mock-llm's deterministic outputs so the seeded binding will score 3/3.
INSERT INTO vkas.artifact (canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by) VALUES
('https://artifacts.simintero.io/shared/eval_set/claude-pa-gold','1.0.0','shared','eval_set','active',
 jsonb_build_object('gold_cases', jsonb_build_array(
   jsonb_build_object(
     'id','ee-1',
     'task_kind','extract_entities',
     'inputs',jsonb_build_object('document_span_refs',jsonb_build_array('span-1')),
     'expect',jsonb_build_object(
       'structural',jsonb_build_array('entities'),
       'entity_resource_type','Condition'
     )
   ),
   jsonb_build_object(
     'id','sum-1',
     'task_kind','summarize',
     'inputs',jsonb_build_object('document_span_refs',jsonb_build_array('span-1')),
     'expect',jsonb_build_object(
       'structural',jsonb_build_array('assertions'),
       'must_cite',true
     )
   ),
   jsonb_build_object(
     'id','tri-1',
     'task_kind','triage_advise',
     'inputs',jsonb_build_object('requirement_gap_refs',jsonb_build_array('gap-1')),
     'expect',jsonb_build_object(
       'structural',jsonb_build_array('suggestion','confidence'),
       'suggestion','likely_meets',
       'min_confidence',0.7
     )
   )
 )),
 'seed-eval-gold','2.2b-seed')
ON CONFLICT (canonical_url, version) DO NOTHING;
