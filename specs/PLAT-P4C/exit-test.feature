@phase4 @phase4c @claims @exit-gate
Feature: Phase 4C exit — Claims, appeals, and IRO routing

  Background:
    Given the synthetic MA tenant "t_synth_ma" is provisioned and active

  Scenario: Claim case created and tracked
    When a claim is submitted via "POST /v1/claims" with claim_number "CLM-2026-001"
    Then the response has status 201 with a case_ref captured as "claim_case_ref"
    And a "claims.claim" row exists with claim_number "CLM-2026-001"
    And an "ens.case" row exists with case_type "claim"

  Scenario: Appeal filed with original case linkage
    Given a claim case exists with case_ref "claim_case_ref"
    When an appeal is filed via "POST /v1/appeals" with original_case_ref "claim_case_ref" and appeal_type "standard"
    Then the response has status 201 with a case_ref captured as "appeal_case_ref"
    And a "claims.appeal" row exists linking "appeal_case_ref" to "claim_case_ref"

  Scenario: IRO appeal triggers referral outbox event
    Given an appeal case exists with appeal_type "iro" and case_ref "iro_appeal_ref"
    When the IRO routing workflow runs for "iro_appeal_ref"
    Then a "shared.outbox" row exists with topic "sim.claims.iro" and event_type "IROReferred"
    And the outbox payload does not contain any raw clinical content
    And the "ens.case" status for "iro_appeal_ref" is "IRO_PENDING"
