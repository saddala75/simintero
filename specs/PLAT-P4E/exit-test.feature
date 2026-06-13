@phase4 @phase4e @market-bundles @exit-gate
Feature: Market Bundle Provisioning

  Background:
    Given the platform is running
    And the tenant "acme" is provisioned

  @phase4 @phase4e @market-bundles @exit-gate
  Scenario: Provisioning a market bundle creates it in draft status
    Given no bundle with ref "ma-starter-2026" exists for tenant "acme"
    When tenant "acme" provisions bundle ref "ma-starter-2026" for lob "MA"
    Then the response status is 201
    And the bundle status in the response is "draft"
    And the market.bundle record for "ma-starter-2026" has status "draft"

  @phase4 @phase4e @market-bundles @exit-gate
  Scenario: Bundle activation requires a human reviewer_id
    Given a bundle "ma-starter-2026" exists with status "draft" for tenant "acme"
    When an activation request is made without a reviewer_id
    Then the BundleValidator rejects the request
    And the error contains "reviewer_id_required"

  @phase4 @phase4e @market-bundles @exit-gate
  Scenario: Fetching a bundle returns its artifacts
    Given bundle "ma-starter-2026" with lob "MA" exists for tenant "acme"
    And the bundle has artifact "pa-standard-ma" with role "policy"
    When tenant "acme" requests bundle ref "ma-starter-2026"
    Then the response status is 200
    And the response includes the "policy" artifact
