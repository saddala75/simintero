@phase4 @phase4a @search @exit-gate
Feature: Phase 4A exit — Universal search across backbone event types

  Background:
    Given the synthetic MA tenant "t_synth_ma" is provisioned and active
    And a case "case_synth_001" with member "m_synth_ma_001" has been determined

  Scenario: Cross-module search returns indexed case entity
    Given the search indexer has processed the "CaseDetermined" event for "case_synth_001"
    Then a "search.index_event" row exists for entity_id "case_synth_001" and entity_type "case"

    When a search is requested via "GET /v1/search?q=case_synth_001"
    Then the response contains field "results" with at least one entry
    And the result entry has entity_type "case" and entity_id "case_synth_001"
    And the response contains field "query_hash" as a 64-character hex string

  Scenario: Query text is never stored in plain text (PHI safety)
    When a search is requested via "GET /v1/search?q=confidential_clinical_query"
    Then no "search.search_log" row contains the raw text "confidential_clinical_query"
    And the "search.search_log" row contains field "query_hash" as a SHA-256 hex digest
