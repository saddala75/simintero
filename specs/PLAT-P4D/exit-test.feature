@phase4 @phase4d @automation @exit-gate
Feature: Constrained Automation Gate

  Background:
    Given the platform is running
    And the tenant "acme" is provisioned

  @phase4 @phase4d @automation @exit-gate
  Scenario: OPA gate blocks adverse disposition outcomes
    Given a case "case-auto-1" exists for tenant "acme"
    When the automation service receives a disposition request with proposed_outcome "deny"
    Then the response status is 422
    And the error code is "SIM-AUTO-ADVERSE_BLOCKED"
    And no automation.disposition_log entry has allow = true for case "case-auto-1"

  @phase4 @phase4d @automation @exit-gate
  Scenario: Dry-run mode is the default when ai.automation.live is not set
    Given a case "case-auto-2" exists for tenant "acme"
    And the "ai.automation.live" entitlement is not set for tenant "acme"
    And the OPA gate would allow the disposition
    When the automation service processes a disposition for case "case-auto-2" with proposed_outcome "approve"
    Then the response status is 200
    And the response body contains status "dry_run"
    And the ens.case state for "case-auto-2" is not "auto_disposed"

  @phase4 @phase4d @automation @exit-gate
  Scenario: Audit trail is written for every gate decision
    Given a case "case-auto-3" exists for tenant "acme"
    When the automation service receives a disposition request with proposed_outcome "modify"
    Then the response status is 422
    And an automation.disposition_log entry exists for case "case-auto-3"
    And the disposition_log entry has allow = false
    And the disposition_log entry has dry_run = true
