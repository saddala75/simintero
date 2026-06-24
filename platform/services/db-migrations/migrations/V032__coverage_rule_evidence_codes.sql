-- V032: enrich the knee-arthroscopy (27447) coverage_rule evidence_requirements with
-- code-aware matching metadata (evidence_types/codes/negates) for Revital's evidence-to-criteria
-- mapping (slice 2.5). Additive: Digicore CQL evaluation is unchanged. diagnosis_documented gains
-- an affirming code (Osteoarthritis of knee) + a negating code (Knee pain) to demonstrate conflicts.
UPDATE vkas.artifact
SET content = jsonb_set(
  content,
  '{evidence_requirements}',
  $req$[
    {"requirement_id":"diagnosis_documented","display":"Diagnosis of knee condition documented","required":true,
     "evidence_types":["Condition"],
     "codes":[{"system":"http://snomed.info/sct","code":"239873007"}],
     "negates":[{"system":"http://snomed.info/sct","code":"30989003"}]},
    {"requirement_id":"conservative_therapy_tried","display":"Conservative therapy attempted and documented","required":true,
     "evidence_types":["Procedure"],
     "codes":[{"system":"http://www.ama-assn.org/go/cpt","code":"97110"}],
     "negates":[]},
    {"requirement_id":"imaging_documented","display":"Imaging (X-ray or MRI) documented","required":true,
     "evidence_types":["DiagnosticReport","Observation"],
     "codes":[{"system":"http://loinc.org","code":"24604-1"}],
     "negates":[]}
  ]$req$::jsonb)
WHERE canonical_url = 'https://artifacts.simintero.io/shared/coverage_rule/27447' AND version = '1.0.0';
