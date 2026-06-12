# Phase 0 Exit Test
# Validates the full platform substrate: tenant provisioning, RLS, outbox,
# event replay, and audit trail — using synthetic fixtures only, no real PHI.
#
# Runner: pnpm --filter @sim/e2e run test -- --spec specs/PLAT-P0/exit-test.feature
# Requires: docker compose up -d postgres redpanda keycloak opa outbox-relay
# Synthetic data: artifacts/synthetic/tenants/t_synth_ma.json

# After each scenario: the test runner must delete all rows for t_synth_ma and
# t_synth_medicaid from ctrl.tenant, ctrl.entitlement, ens.case, ens.case_event,
# shared.outbox, and shared.processed_events to ensure idempotent re-runs.
# Implement via an @After hook in the Cucumber step definitions.
@phase0 @wipe_tenants
Feature: Phase 0 exit — synthetic tenant provision and case lifecycle

  Background:
    Given the Simintero platform services are running
    And the pooled cell "cell-pooled-us1" is active
    And the synthetic tenant "t_synth_ma" is provisioned and active
    And the synthetic tenant "t_synth_medicaid" is provisioned and active

  Scenario: Verify RLS isolation between synthetic tenants
    Then the RLS harness passes for tenant "t_synth_ma" on cell "cell-pooled-us1"
    And the ctrl.tenant table contains a row with tenant_id "t_synth_ma" and status "active"
    And the ctrl.tenant table contains a row with tenant_id "t_synth_medicaid" and status "active"

  Scenario: Create and replay a skeletal case event
    When an actor with role "um_nurse_reviewer" in tenant "t_synth_ma" appends a CaseCreated event for case "case_exit_test_01"
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
