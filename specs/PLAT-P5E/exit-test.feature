# Phase 5E Exit Test
# Validates the PHI redaction pipeline: document text is analyzed by Presidio,
# entities are redacted, and the result is stored in docs.redaction_view.
#
# Runner: pnpm --filter @sim/e2e run test:p5e
# Requires: docker compose -f integration/e2e/docker-compose.test.yml up -d
# Fixture UUIDs:
#   doc_fixture_01  → a0e10001-0000-4000-8000-000000000001
#   quarantine_doc_01 → a0e10002-0000-4000-8000-000000000002

@phase5e @redaction @exit-gate
Feature: Phase 5E exit — Document redaction creates PHI-safe redaction view

  Background:
    Given the Document Service is running at the configured URL
    And the Presidio analyzer and anonymizer are running
    And the synthetic MA tenant "t_synth_ma" has a clean document with doc_id "doc_fixture_01"

  Scenario: Redaction creates a PHI-safe redaction view
    When a redaction is requested for document "doc_fixture_01" by tenant "t_synth_ma"
    Then the response status is 201
    And the response body contains field "view_id" as a UUID
    And the response body contains field "entity_count" as a positive integer
    And the docs.redaction_view table contains a row for document "doc_fixture_01" in tenant "t_synth_ma"

  Scenario: Redaction is rejected for quarantined document
    Given a document "quarantine_doc_01" exists for tenant "t_synth_ma" with virus_scan_status "quarantined"
    When a redaction is requested for document "quarantine_doc_01" by tenant "t_synth_ma"
    Then the response status is 451
    And the response body contains field "code" equal to "SIM-PLAT-DOC-QUARANTINED"

  Scenario: Redacted view is retrievable after creation
    When a redaction is requested for document "doc_fixture_01" by tenant "t_synth_ma"
    Then the response status is 201
    When the redaction view is fetched using the returned view_id for document "doc_fixture_01" by tenant "t_synth_ma"
    Then the response status is 200
    And the response body field "redacted_text" does not contain "John Smith"
    And the response body field "redacted_text" contains "[REDACTED"
