-- V020__seed_qual_measure_demo.sql
-- Make Qualitron runnable end-to-end: a measure DEFINITION + clinical FHIR data.
-- All seeded under tenant 'tenant-dev' (fabric.resource RLS has no `shared` escape).

-- qual.measure_definition: the numerator/denominator/exclusion spec qualitron evaluates.
CREATE TABLE IF NOT EXISTS qual.measure_definition (
  measure_ref   TEXT NOT NULL,
  version       TEXT NOT NULL,
  tenant_id     TEXT NOT NULL,
  title         TEXT NOT NULL,
  spec          JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (measure_ref, version)
);
ALTER TABLE qual.measure_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE qual.measure_definition FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON qual.measure_definition;
CREATE POLICY tenant_isolation ON qual.measure_definition
  USING (tenant_id = current_setting('sim.tenant_id', true));

-- Demo measure: breast-cancer screening (BCS-E). denominator = eligible Patient;
-- numerator = has a mammography Observation (LOINC 24604-1) in the period.
INSERT INTO qual.measure_definition (measure_ref, version, tenant_id, title, spec) VALUES
('hedis:BCS-E','1.0.0','tenant-dev','Breast Cancer Screening',
 jsonb_build_object(
   'denominator', jsonb_build_object('resource_type','Patient'),
   'numerator',   jsonb_build_object('resource_type','Observation','code','24604-1'),
   'exclusion',   jsonb_build_object('resource_type','Condition','code','hospice')))
ON CONFLICT (measure_ref, version) DO NOTHING;

-- Seed FHIR data under tenant-dev: 4 Patients; 2 have the numerator Observation
-- (member-001, member-002) -> denominator=4, numerator=2, gaps=2, rate=0.5.
-- provenance_ref is NOT NULL after V014 (no default) -> supplied explicitly.
INSERT INTO fabric.resource (tenant_id, resource_type, fhir_id, member_ref, source, provenance_ref, last_updated, content) VALUES
('tenant-dev','Patient','pat-001','member-001','seed-p1a','seed:p1a','2026-03-01T00:00:00Z', jsonb_build_object('resourceType','Patient','id','pat-001','gender','female')),
('tenant-dev','Patient','pat-002','member-002','seed-p1a','seed:p1a','2026-03-01T00:00:00Z', jsonb_build_object('resourceType','Patient','id','pat-002','gender','female')),
('tenant-dev','Patient','pat-003','member-003','seed-p1a','seed:p1a','2026-03-01T00:00:00Z', jsonb_build_object('resourceType','Patient','id','pat-003','gender','female')),
('tenant-dev','Patient','pat-004','member-004','seed-p1a','seed:p1a','2026-03-01T00:00:00Z', jsonb_build_object('resourceType','Patient','id','pat-004','gender','female')),
('tenant-dev','Observation','obs-001','member-001','seed-p1a','seed:p1a','2026-04-15T00:00:00Z',
   jsonb_build_object('resourceType','Observation','id','obs-001','code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object('system','http://loinc.org','code','24604-1'))))),
('tenant-dev','Observation','obs-002','member-002','seed-p1a','seed:p1a','2026-04-20T00:00:00Z',
   jsonb_build_object('resourceType','Observation','id','obs-002','code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object('system','http://loinc.org','code','24604-1')))))
ON CONFLICT (tenant_id, resource_type, fhir_id) DO NOTHING;
