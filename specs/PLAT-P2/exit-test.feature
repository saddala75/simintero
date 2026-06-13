@phase2 @advisory @exit-gate
Feature: Phase 2 exit — Revital advisory visible in reviewer workspace

  Background:
    Given the synthetic MA tenant "t_synth_ma" is provisioned and active
    And the Model Gateway is configured with the mock Anthropic adapter
    And the mock adapter returns deterministic cited responses for all task_kinds
    And the Document Service has ingested fixture document "doc_fixture_pa_therapy_notes.pdf" with doc_id "doc_fixture_01" and virus_scan_status "clean"

  Scenario: Full advisory flow — from PAS submission to cited advisory in workspace
    # 1. Submit a PA case via FHIR PAS
    Given a valid PAS ClaimBundle for member "m_synth_ma_001" with service category "ortho" and urgency "standard"
    When the FHIR facade receives "POST /fhir/ClaimResponse/$submit" with the ClaimBundle
    Then the response status is 202
    And a case is created with status "INTAKE"
    And the case_ref is captured as "test_case_ref"

    # 2. Intake and completeness evaluation advance the workflow
    When the Temporal workflow "revitalAnalyzeCase" starts for "test_case_ref"
    And the workflow waits for the Revital analysis trigger

    # 3. Verify Revital analysis is triggered and completes
    When the Revital pipeline receives "POST /v1/assist/analyses" with case_ref "test_case_ref" and document_refs ["doc_fixture_01"]
    Then a "revital.analysis" row exists with analysis_id captured as "test_analysis_id"
    And the analysis status is eventually "complete" within 30 seconds

    # 4. Verify the advisory result shape — INV-1, INV-2, INV-3
    When the analysis result is fetched via "GET /v1/assist/analyses/{test_analysis_id}"
    Then the response body contains classification "advisory"
    And the response body contains status "complete"
    And the summary block status is "ok"
    And the summary assertions list has at least 1 item
    And every assertion in the summary has at least 1 citation
    And every citation has a non-null "trace_ref"
    And the triage block status is "ok"
    And the triage suggestion is one of ["likely_meets", "needs_rfi", "route_to_clinician"]

    # 5. Verify the BFF advisory resolver surfaces the full result (not the stub)
    When the reviewer workspace GraphQL query "advisory(caseId: \"{test_case_ref}\")" is executed
    Then the response contains field "advisory.status" equal to "available"
    And the response contains field "advisory.result.classification" equal to "advisory"
    And the response contains field "advisory.result.summary.assertions" with at least 1 item

    # 6. Verify reviewer feedback is accepted
    When the reviewer posts feedback via "POST /v1/assist/analyses/{test_analysis_id}/feedback" with item target "triage" action "accepted"
    Then the response status is 204
    And a "revital.feedback" row exists for "test_analysis_id"

    # 7. Verify outbox emitted the expected events
    Then the "shared.outbox" table contains a row with topic "sim.ai.interaction" and payload field "event_type" equal to "AnalysisCompleted"
    And the "shared.outbox" table contains a row with topic "sim.ai.interaction" and payload field "event_type" equal to "FeedbackRecorded"

  Scenario: Advisory degrades gracefully when Model Gateway is unavailable
    Given the Model Gateway is configured to return 503 for all requests
    And a PA case "test_case_ref_2" exists with document_refs ["doc_fixture_01"]
    When the Revital pipeline is triggered for "test_case_ref_2"
    Then the "revital.analysis" row status becomes "partial" or "failed" within 30 seconds
    And the reviewer workspace BFF advisory query for "test_case_ref_2" returns status "available"
    And the advisory result status is "partial" or "failed"
    And the Enstellar PA workflow for "test_case_ref_2" is NOT blocked
    And the PA case state is NOT "voided" (advisory failure must not block human review path)
