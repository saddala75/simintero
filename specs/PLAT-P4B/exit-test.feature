@phase4 @phase4b @analytics @exit-gate
Feature: Phase 4B exit — Unified analytics margin + platform aggregate

  Background:
    Given the synthetic MA tenant "t_synth_ma" is provisioned and active
    And there are sim.ai.interaction outbox events for "t_synth_ma" in period "2026-01-01" to "2026-12-31"

  Scenario: Margin snapshot computed from FinOps inference cost
    When the margin compute worker runs for tenant "t_synth_ma" and period "2026-01-01" to "2026-12-31"
    Then an "analytics.margin_snapshot" row exists for tenant "t_synth_ma"
    And the snapshot "cost_usd" matches the sum of provider_cost_usd from outbox events
    And the snapshot "revenue_usd" is 0 (pending claims billing integration)

    When the margin is fetched via "GET /v1/analytics/margin"
    Then the response contains at least one snapshot with "cost_usd" greater than 0

  Scenario: Platform aggregate contains no tenant-identifying information
    When the platform aggregate is fetched via "GET /v1/analytics/platform-summary"
    Then the response contains field "tenant_count" as an integer
    And the response body does not contain the string "t_synth_ma"
    And the response body does not contain any tenant_id value
