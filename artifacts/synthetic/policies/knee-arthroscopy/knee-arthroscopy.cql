library KneeArthroscopy version '1.0.0'

using FHIR version '4.0.1'

context Patient

/*
 * Knee Arthroscopy Prior Authorization Criteria
 *
 * Phase 1 synthetic CQL — represents the clinical logic for determining
 * prior authorization requirements for knee arthroscopy procedures (CPT 27447).
 *
 * Criteria:
 *  1. Diagnosis of knee condition is documented
 *  2. Conservative therapy (PT, NSAIDs, etc.) has been attempted ≥ 6 weeks
 *  3. Imaging (X-ray or MRI) is documented
 */

define "Diagnosis Documented":
  exists (
    [Condition: "Knee Condition Codes"] C
      where C.clinicalStatus ~ 'active'
  )

define "Conservative Therapy Tried":
  exists (
    [Procedure: "Conservative Therapy Codes"] P
      where P.status = 'completed'
        and duration in weeks of P.performed >= 6
  )

define "Imaging Documented":
  exists (
    [DiagnosticReport: "Knee Imaging Codes"] R
      where R.status in { 'final', 'amended', 'corrected' }
  )

define "Meets All Criteria":
  "Diagnosis Documented"
    and "Conservative Therapy Tried"
    and "Imaging Documented"
