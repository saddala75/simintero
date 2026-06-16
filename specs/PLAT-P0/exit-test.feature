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

  # C3a: removed — drove the retired TS enstellar-case service (event append/replay/GET);
  # case lifecycle + audit coverage now in interop ITs + portal Playwright.
