-- V026__seed_fhir_retrieve_demo.sql
-- Slice 1.1 proof: a type-only FHIR Retrieve coverage rule + referenced FHIR data,
-- so digicore evaluates real CQL-vs-FHIR against fabric.resource.

-- 1. Referenced FHIR resources for member-001 / pat-001 (tenant-dev).
INSERT INTO fabric.resource (tenant_id, resource_type, fhir_id, member_ref, source, provenance_ref, last_updated, content) VALUES
('tenant-dev','Condition','cond-001','member-001','seed-1.1','seed:slice1.1','2026-05-01T00:00:00Z',
  jsonb_build_object('resourceType','Condition','id','cond-001',
    'subject', jsonb_build_object('reference','Patient/pat-001'),
    'clinicalStatus', jsonb_build_object('coding', jsonb_build_array(
      jsonb_build_object('system','http://terminology.hl7.org/CodeSystem/condition-clinical','code','active'))))),
('tenant-dev','Procedure','proc-001','member-001','seed-1.1','seed:slice1.1','2026-05-02T00:00:00Z',
  jsonb_build_object('resourceType','Procedure','id','proc-001','status','completed',
    'subject', jsonb_build_object('reference','Patient/pat-001')))
ON CONFLICT (tenant_id, resource_type, fhir_id) DO NOTHING;

-- 2. The FHIR-data cql_library + coverage_rule pair.
--    Column list matches V018: canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by.
--    CQL is byte-identical to the string asserted in RuleLibraryCompileTest#fhirRetrieveDemoRuleCompiles.
INSERT INTO vkas.artifact (canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by) VALUES
('https://artifacts.simintero.io/shared/cql_library/fhir-retrieve-demo','1.0.0','shared','cql_library','active',
 jsonb_build_object('cql', $cql$library FhirRetrieveDemo version '1.0.0'
using FHIR version '4.0.1'
context Patient
define "Has Condition": exists [Condition]
define "Has Procedure": exists [Procedure]
define "Meets All Criteria": "Has Condition" and "Has Procedure"
$cql$),
 'seed-fhir-retrieve-cql','seed-1.1'),
('https://artifacts.simintero.io/shared/coverage_rule/29827','1.0.0','shared','coverage_rule','active',
 jsonb_build_object(
   'procedure_codes', jsonb_build_array('29827'),
   'pa_required', true,
   'pins', jsonb_build_array(),
   'evidence_requirements', jsonb_build_array(),
   'elm_ref','https://artifacts.simintero.io/shared/cql_library/fhir-retrieve-demo',
   'elm_version','1.0.0'),
 'seed-fhir-retrieve-rule','seed-1.1')
ON CONFLICT (canonical_url, version) DO NOTHING;
