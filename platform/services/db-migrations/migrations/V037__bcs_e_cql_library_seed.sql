-- Seeds BCS-E as a VKAS cql_library artifact so Digicore CqfEvaluator can resolve it.
-- The CQL is minimal on purpose: FabricRetrieveProvider returns all member resources;
-- the legacy SQL path handles period filtering. This layer proves CQL → FHIR → populationBooleans.
INSERT INTO vkas.artifact (
  canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by
) VALUES (
  'https://artifacts.simintero.io/shared/cql_library/bcs-e',
  '1.0.0',
  'shared',
  'cql_library',
  'active',
  jsonb_build_object('cql', $cql$library BcsE version '1.0.0'

using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1'

codesystem LOINC: 'http://loinc.org'

code "Mammogram": '24604-1' from LOINC
code "HospiceCode": 'hospice' from LOINC

context Patient

define "Denominator":
  true

define "Exclusion":
  exists (
    [Condition] C
      where exists (
        C.code.coding C2
          where C2.system = 'http://loinc.org' and C2.code = 'hospice'
      )
  )

define "Numerator":
  exists (
    [Observation] O
      where exists (
        O.code.coding C2
          where C2.system = 'http://loinc.org' and C2.code = '24604-1'
      )
  )

define "Exception":
  false

define "Meets All Criteria":
  "Denominator" and "Numerator" and not "Exclusion" and not "Exception"
$cql$),
  md5(jsonb_build_object('cql', 'bcs-e-v1-placeholder')::text),
  'seed'
)
ON CONFLICT (canonical_url, version) DO NOTHING;
