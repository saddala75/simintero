# Phase 1 Exit Test
# Validates the full PA vertical slice: FHIR PAS intake → Enstellar case creation →
# PaWorkflow Temporal orchestration → Revital advisory → reviewer determination → outbox.
#
# Runner: pnpm --filter @sim/e2e run test:p1
# Requires: fhir-facade:8090, enstellar-intake:3003, enstellar-case:3013,
#           revital-pipeline:3050, workspace-bff:4010, temporal:7233
# Synthetic data: t_synth_ma, m_synth_ma_001
#
# After each scenario: @After hook (registered in hooks.ts) deletes all rows
# created for t_synth_ma to ensure idempotent re-runs.

@phase1 @pa-workflow @exit-gate @wipe_tenants
Feature: Phase 1 exit — PA vertical slice from FHIR PAS submission to determination

  Background:
    Given the Simintero platform services are running
    And the synthetic MA tenant "t_synth_ma" is provisioned and active
    And the Revital advisory pipeline is configured with the mock Anthropic adapter

  Scenario: Full PA happy path — FHIR PAS submission to approval determination
    # 1. Submit PAS bundle and verify acceptance
    When a valid PAS ClaimBundle is submitted for member "m_synth_ma_001" with service_category "ortho" and urgency "standard"
    Then the FHIR facade responds with status 200
    And an ens.case row is created for tenant "t_synth_ma" with channel "PAS" within 5 seconds
    And the case_id is captured as "pa_case_id"

    # 2. Temporal workflow starts in intake state
    And the PaWorkflow "pa-workflow-{pa_case_id}" starts in state "intake" within 5 seconds

    # 3. Workflow advances through completeness_check to clinical_review
    When the PaWorkflow "pa-workflow-{pa_case_id}" advances to state "clinical_review" within 30 seconds

    # 4. Revital advisory is requested and eventually completes
    Then a revital.analysis row exists for case_ref "{pa_case_id}" with status "complete" within 30 seconds
    And the analysis_id is captured as "pa_analysis_id"

    # 5. Reviewer records approval decision
    When a reviewer records a determination for case "{pa_case_id}" with outcome "approved" and decided_by "rev_synth_01"
    Then the determination response status is 200
    And an ens.determination row exists for case "{pa_case_id}" with outcome "approved"
    And an ens.case_event row exists for case "{pa_case_id}" with event_type "DeterminationRecorded"

    # 6. Temporal workflow reaches determined state
    And the PaWorkflow "pa-workflow-{pa_case_id}" advances to state "determined" within 15 seconds

    # 7. Outbox emits DeterminationRecorded on sim.case.lifecycle
    And a shared.outbox row exists with topic "sim.case.lifecycle" and schema_ref "sim.case.lifecycle/DeterminationRecorded/v1" for case "{pa_case_id}"
    And the outbox envelope payload field "outcome" equals "approved"
    And the outbox envelope does not contain fields "diagnosis_text" or "clinical_notes" or "raw_notes" or "phi"

  Scenario: RFI issuance and satisfaction — case resumes after RFI resolved
    Given a PA case "rfi_test_case_01" is seeded for tenant "t_synth_ma" via intake
    And the PaWorkflow "pa-workflow-{rfi_test_case_01}" is started for case "rfi_test_case_01" tenant "t_synth_ma" urgency "standard"
    And the PaWorkflow "pa-workflow-{rfi_test_case_01}" advances to state "rfi_pending" within 30 seconds

    # RFI created by PaWorkflow createRfi activity
    Then an ens.rfi row exists for case "rfi_test_case_01" with status "open" within 10 seconds
    And the rfi_id is captured as "test_rfi_id"

    # Satisfy the RFI via the workflow signal
    When the RFI "{test_rfi_id}" for case "rfi_test_case_01" is satisfied via signal
    Then the ens.rfi row for "{test_rfi_id}" has status "satisfied" within 5 seconds
    And a shared.outbox row exists with topic "sim.case.lifecycle" and schema_ref "sim.case.lifecycle/RfiSatisfied/v1" for case "rfi_test_case_01"

    # Workflow should advance to clinical_review after RFI satisfaction
    And the PaWorkflow "pa-workflow-{rfi_test_case_01}" advances to state "clinical_review" within 15 seconds

  Scenario: Case withdrawal during clinical review — workflow reaches withdrawn state
    Given a PA case "withdraw_test_case_01" is seeded for tenant "t_synth_ma" in state "clinical_review"

    # Send withdraw signal
    When the PA workflow "pa-workflow-{withdraw_test_case_01}" is withdrawn with reason "member_withdrew"
    Then the PaWorkflow "pa-workflow-{withdraw_test_case_01}" advances to state "withdrawn" within 10 seconds
    And the ens.case row for case "withdraw_test_case_01" has state "withdrawn" within 5 seconds
    And a shared.outbox row exists with topic "sim.case.lifecycle" and schema_ref "sim.case.lifecycle/CaseStateChanged/v1" for case "withdraw_test_case_01"
    And the outbox envelope payload field "to" equals "withdrawn"
