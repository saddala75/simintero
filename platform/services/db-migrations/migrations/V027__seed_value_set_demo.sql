-- V027__seed_value_set_demo.sql
-- Slice 1.2 proof: value-set membership filtering. A coded Condition in the Knee VS (member-001)
-- and one NOT in it (member-002) prove the engine FILTERS, not just exists.

-- 1. Matching Condition for member-001: SNOMED 239873007 (Osteoarthritis of knee) — IS in the Knee VS.
--    Non-matching Condition for member-002: SNOMED 73211009 (Diabetes mellitus) — NOT in the Knee VS.
INSERT INTO fabric.resource (tenant_id, resource_type, fhir_id, member_ref, source, provenance_ref, last_updated, content) VALUES
('tenant-dev','Condition','cond-knee-001','member-001','seed-1.2','seed:slice1.2','2026-05-10T00:00:00Z',
  jsonb_build_object('resourceType','Condition','id','cond-knee-001',
    'subject', jsonb_build_object('reference','Patient/pat-001'),
    'clinicalStatus', jsonb_build_object('coding', jsonb_build_array(
      jsonb_build_object('system','http://terminology.hl7.org/CodeSystem/condition-clinical','code','active'))),
    'code', jsonb_build_object('coding', jsonb_build_array(
      jsonb_build_object('system','http://snomed.info/sct','code','239873007','display','Osteoarthritis of knee'))))),
('tenant-dev','Condition','cond-other-002','member-002','seed-1.2','seed:slice1.2','2026-05-10T00:00:00Z',
  jsonb_build_object('resourceType','Condition','id','cond-other-002',
    'subject', jsonb_build_object('reference','Patient/pat-002'),
    'clinicalStatus', jsonb_build_object('coding', jsonb_build_array(
      jsonb_build_object('system','http://terminology.hl7.org/CodeSystem/condition-clinical','code','active'))),
    'code', jsonb_build_object('coding', jsonb_build_array(
      jsonb_build_object('system','http://snomed.info/sct','code','73211009','display','Diabetes mellitus')))))
ON CONFLICT (tenant_id, resource_type, fhir_id) DO NOTHING;

-- 2. CQL library + coverage rule for service code 29828.
--    Column list matches V018/V026: canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by.
--    CQL is byte-identical to the string asserted in RuleLibraryCompileTest#kneeValueSetRuleCompiles.
INSERT INTO vkas.artifact (canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by) VALUES
('https://artifacts.simintero.io/shared/cql_library/knee-vs-proof','1.0.0','shared','cql_library','active',
 jsonb_build_object('cql', $cql$library KneeVsProof version '1.0.0'
using FHIR version '4.0.1'
valueset "Knee Condition Codes": 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.526.3.1498'
context Patient
define "Has Knee Condition": exists ([Condition: "Knee Condition Codes"])
define "Meets All Criteria": "Has Knee Condition"
$cql$),
 'seed-knee-vs-cql','seed-1.2'),
('https://artifacts.simintero.io/shared/coverage_rule/29828','1.0.0','shared','coverage_rule','active',
 jsonb_build_object(
   'procedure_codes', jsonb_build_array('29828'),
   'pa_required', true,
   'pins', jsonb_build_array(),
   'evidence_requirements', jsonb_build_array(),
   'elm_ref','https://artifacts.simintero.io/shared/cql_library/knee-vs-proof',
   'elm_version','1.0.0'),
 'seed-knee-vs-rule','seed-1.2')
ON CONFLICT (canonical_url, version) DO NOTHING;
