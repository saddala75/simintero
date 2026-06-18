-- Seed coverage_rule + cql_library artifacts the digicore-runtime resolves from VKAS.
-- For each procedure: a cql_library artifact (content {"cql": "<source>"}, byte-identical
-- to the modules/digicore/runtime/src/main/resources/cql/*.cql resource) and a coverage_rule
-- artifact whose elm_ref points at the cql_library canonical_url. digicore compiles the CQL
-- at resolve time (RuleLibraryCompileTest guards seed validity).
-- 8 artifacts total: 4 cql_library + 4 coverage_rule. All status='active', tenant_id='shared'.

INSERT INTO vkas.artifact (canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by) VALUES
-- knee arthroscopy (27447)
('https://artifacts.simintero.io/shared/cql_library/knee-arthroscopy','1.0.0','shared','cql_library','active',
 jsonb_build_object('cql', $cql$library KneeArthroscopy version '1.0.0'
parameter "diagnosis_documented" Boolean
parameter "conservative_therapy_tried" Boolean
parameter "imaging_documented" Boolean
define "Diagnosis Documented": "diagnosis_documented"
define "Conservative Therapy Tried": "conservative_therapy_tried"
define "Imaging Documented": "imaging_documented"
define "Meets All Criteria":
  "Diagnosis Documented" and "Conservative Therapy Tried" and "Imaging Documented"
$cql$),
 'seed-knee-cql','p1b2a-seed'),
('https://artifacts.simintero.io/shared/coverage_rule/27447','1.0.0','shared','coverage_rule','active',
 jsonb_build_object(
   'procedure_codes', jsonb_build_array('27447'),
   'pa_required', true,
   'pins', jsonb_build_array('urn:sim:policy:knee-arthroscopy:1.0.0'),
   'dtr_package_ref', 'urn:sim:dtr:knee-arthroscopy:1.0.0',
   'evidence_requirements', jsonb_build_array(
     jsonb_build_object('requirement_id','diagnosis_documented','display','Diagnosis of knee condition documented','required',true),
     jsonb_build_object('requirement_id','conservative_therapy_tried','display','Conservative therapy attempted and documented','required',true),
     jsonb_build_object('requirement_id','imaging_documented','display','Imaging (X-ray or MRI) documented','required',true)),
   'elm_ref','https://artifacts.simintero.io/shared/cql_library/knee-arthroscopy',
   'elm_version','1.0.0'),
 'seed-knee-rule','p1b2a-seed'),
-- lumbar spine MRI (72148)
('https://artifacts.simintero.io/shared/cql_library/lumbar-spine-mri','1.0.0','shared','cql_library','active',
 jsonb_build_object('cql', $cql$library LumbarSpineMri version '1.0.0'
parameter "conservative_therapy_6wk" Boolean
parameter "neuro_deficit_or_red_flag" Boolean
define "Conservative Therapy 6wk": "conservative_therapy_6wk"
define "Neuro Deficit Or Red Flag": "neuro_deficit_or_red_flag"
define "Meets All Criteria":
  "Conservative Therapy 6wk" and "Neuro Deficit Or Red Flag"
$cql$),
 'seed-lumbar-cql','p1b2a-seed'),
('https://artifacts.simintero.io/shared/coverage_rule/72148','1.0.0','shared','coverage_rule','active',
 jsonb_build_object(
   'procedure_codes', jsonb_build_array('72148'),
   'pa_required', true,
   'pins', jsonb_build_array('urn:sim:policy:lumbar-spine-mri:1.0.0'),
   'dtr_package_ref', 'urn:sim:dtr:lumbar-spine-mri:1.0.0',
   'evidence_requirements', jsonb_build_array(
     jsonb_build_object('requirement_id','conservative_therapy_6wk','display','At least 6 weeks of conservative therapy documented','required',true),
     jsonb_build_object('requirement_id','neuro_deficit_or_red_flag','display','Neurologic deficit or red-flag finding documented','required',true)),
   'elm_ref','https://artifacts.simintero.io/shared/cql_library/lumbar-spine-mri',
   'elm_version','1.0.0'),
 'seed-lumbar-rule','p1b2a-seed'),
-- upper endoscopy (43239)
('https://artifacts.simintero.io/shared/cql_library/upper-endoscopy','1.0.0','shared','cql_library','active',
 jsonb_build_object('cql', $cql$library UpperEndoscopy version '1.0.0'
parameter "alarm_symptom_documented" Boolean
parameter "failed_ppi_trial" Boolean
define "Alarm Symptom Documented": "alarm_symptom_documented"
define "Failed PPI Trial": "failed_ppi_trial"
define "Meets All Criteria":
  "Alarm Symptom Documented" and "Failed PPI Trial"
$cql$),
 'seed-endoscopy-cql','p1b2a-seed'),
('https://artifacts.simintero.io/shared/coverage_rule/43239','1.0.0','shared','coverage_rule','active',
 jsonb_build_object(
   'procedure_codes', jsonb_build_array('43239'),
   'pa_required', true,
   'pins', jsonb_build_array('urn:sim:policy:upper-endoscopy:1.0.0'),
   'dtr_package_ref', 'urn:sim:dtr:upper-endoscopy:1.0.0',
   'evidence_requirements', jsonb_build_array(
     jsonb_build_object('requirement_id','alarm_symptom_documented','display','Alarm symptom documented','required',true),
     jsonb_build_object('requirement_id','failed_ppi_trial','display','Failed trial of proton-pump inhibitor therapy documented','required',true)),
   'elm_ref','https://artifacts.simintero.io/shared/cql_library/upper-endoscopy',
   'elm_version','1.0.0'),
 'seed-endoscopy-rule','p1b2a-seed'),
-- CT abdomen/pelvis (74178)
('https://artifacts.simintero.io/shared/cql_library/ct-abdomen-pelvis','1.0.0','shared','cql_library','active',
 jsonb_build_object('cql', $cql$library CtAbdomenPelvis version '1.0.0'
parameter "acute_indication_documented" Boolean
parameter "prior_imaging_insufficient" Boolean
define "Acute Indication Documented": "acute_indication_documented"
define "Prior Imaging Insufficient": "prior_imaging_insufficient"
define "Meets All Criteria":
  "Acute Indication Documented" and "Prior Imaging Insufficient"
$cql$),
 'seed-ct-cql','p1b2a-seed'),
('https://artifacts.simintero.io/shared/coverage_rule/74178','1.0.0','shared','coverage_rule','active',
 jsonb_build_object(
   'procedure_codes', jsonb_build_array('74178'),
   'pa_required', true,
   'pins', jsonb_build_array('urn:sim:policy:ct-abdomen-pelvis:1.0.0'),
   'dtr_package_ref', 'urn:sim:dtr:ct-abdomen-pelvis:1.0.0',
   'evidence_requirements', jsonb_build_array(
     jsonb_build_object('requirement_id','acute_indication_documented','display','Acute clinical indication documented','required',true),
     jsonb_build_object('requirement_id','prior_imaging_insufficient','display','Prior imaging insufficient or unavailable documented','required',true)),
   'elm_ref','https://artifacts.simintero.io/shared/cql_library/ct-abdomen-pelvis',
   'elm_version','1.0.0'),
 'seed-ct-rule','p1b2a-seed')
ON CONFLICT (canonical_url, version) DO NOTHING;
