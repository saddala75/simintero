# Phase 0 Exit Test
# Validates the full platform substrate: tenant provisioning, RLS, outbox,
# event replay, and audit trail — using synthetic fixtures only, no real PHI.
#
# Runner: pnpm --filter @sim/e2e run test -- --spec specs/PLAT-P0/exit-test.feature
# Requires: docker compose up -d postgres redpanda keycloak opa
# Synthetic data: artifacts/synthetic/tenants/t_synth_ma.json

Feature: Phase 0 exit — synthetic tenant provision and case lifecycle

  Background:
    Given the Simintero platform services are running
    And the synthetic MA tenant "t_synth_ma" is not yet provisioned

  Scenario: Provision synthetic tenant and verify RLS isolation
    When the provisioning console API creates tenant "t_synth_ma" from fixture "artifacts/synthetic/tenants/t_synth_ma.json"
    Then the tenant status transitions to "active" within 60 seconds
    And the ctrl.tenant table contains a row with tenant_id "t_synth_ma" and status "active"
    And the RLS harness passes for the new tenant's cell with no cross-tenant leaks

  Scenario: Create and replay a skeletal case event
    Given tenant "t_synth_ma" is active
    When an actor with role "um_nurse_reviewer" appends a CaseCreated event for case "case_exit_test_01"
      """
      {
        "case_id": "case_exit_test_01",
        "channel": "PAS",
        "lob": "MA",
        "urgency": "standard",
        "service_category": "orthopedic"
      }
      """
    And the outbox relay publishes the event to the "sim.case.lifecycle" Kafka topic
    And the case consumer replays the event log for case "case_exit_test_01"
    Then the replayed case matches the original payload with all fields preserved
    And the event appears in the audit log with:
      | field          | value                |
      | actor_type     | human                |
      | tenant_id      | t_synth_ma           |
      | schema_ref     | sim.case.created/v1  |
    And the RLS harness confirms tenant "t_synth_medicaid" cannot read case "case_exit_test_01"
