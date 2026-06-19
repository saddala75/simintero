-- V022: seed FHIR value_set artifacts for the terminology service.
-- Reference data, seeded directly (like V018 coverage rules) — not authored through governance.
-- Resolvable via VKAS GET /v1/artifacts:resolve?canonical_url=<url>; readable by all tenants (shared).

INSERT INTO vkas.artifact (canonical_url, version, tenant_id, artifact_type, status, content, content_hash, created_by) VALUES
-- Knee Conditions
('http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.526.3.1498','1','shared','value_set','active',
 jsonb_build_object(
   'resourceType','ValueSet',
   'url','http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.526.3.1498',
   'version','1',
   'status','active',
   'expansion', jsonb_build_object('contains', jsonb_build_array(
     jsonb_build_object('system','http://snomed.info/sct','code','239873007','display','Osteoarthritis of knee'),
     jsonb_build_object('system','http://snomed.info/sct','code','30989003','display','Knee pain'),
     jsonb_build_object('system','http://hl7.org/fhir/sid/icd-10-cm','code','M17.0','display','Bilateral primary osteoarthritis of knee')))),
 'seed-vs-knee','p1d-seed'),
-- Mammography (ties to Qualitron BCS-E numerator LOINC 24604-1)
('http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.108.12.1018','1','shared','value_set','active',
 jsonb_build_object(
   'resourceType','ValueSet',
   'url','http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.108.12.1018',
   'version','1',
   'status','active',
   'expansion', jsonb_build_object('contains', jsonb_build_array(
     jsonb_build_object('system','http://loinc.org','code','24604-1','display','MG Breast Diagnostic Limited Views')))),
 'seed-vs-mammography','p1d-seed'),
-- Encounter — Office Visit
('http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.198.12.1019','1','shared','value_set','active',
 jsonb_build_object(
   'resourceType','ValueSet',
   'url','http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.198.12.1019',
   'version','1',
   'status','active',
   'expansion', jsonb_build_object('contains', jsonb_build_array(
     jsonb_build_object('system','http://www.ama-assn.org/go/cpt','code','99213','display','Office or other outpatient visit, established patient')))),
 'seed-vs-office-visit','p1d-seed');
