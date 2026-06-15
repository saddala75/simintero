-- T11 post-review: add FHIR reference columns to decision_store
-- Required for ClaimResponse.patient (1..1) and ClaimResponse.insurer (1..1) conformance.
-- claim_fhir_id populates ClaimResponse.request.

ALTER TABLE decision_store
    ADD COLUMN IF NOT EXISTS patient_ref    TEXT,
    ADD COLUMN IF NOT EXISTS insurer_ref    TEXT,
    ADD COLUMN IF NOT EXISTS claim_fhir_id  TEXT;
