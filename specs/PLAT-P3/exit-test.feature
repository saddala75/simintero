@phase3 @qualitron @exit-gate
Feature: Phase 3 exit — Qualitron measure execution from live evidence fabric

  Background:
    Given the synthetic MA tenant "t_synth_ma" is provisioned and active
    And the Digicore ELM runtime is configured with the synthetic measure "meas_ma_colorectal_screening"
    And the fabric.resource table contains FHIR resources for member "m_synth_ma_001" with at least one Observation in the measurement period

  Scenario: Full measure execution — gap detected and outreach task created
    Given a measure run is requested via "POST /v1/quality/runs" with measure_ref "https://artifacts.simintero.io/shared/measure/ma-colorectal-screening" and period "2026-01-01" to "2026-12-31"
    Then the run status is "accepted" with a run_id captured as "test_run_id"

    When the Temporal workflow "qualitronRunMeasure" completes for "test_run_id"
    Then a "qual.measure_run" row exists with status "complete"
    And at least one "qual.measure_report" row exists for "test_run_id"
    And the "qual.measure_report" row for member "m_synth_ma_001" has denominator true

    When the gap detection worker processes the "MeasureReportCompleted" event
    Then a "qual.gap" row exists for member "m_synth_ma_001" with status "open"
    And a "qual.outreach_task_ref" row links the gap to a Task Service task

    When the summary is fetched via "GET /v1/quality/measures/{test_run_id}/summary"
    Then the response contains field "denominator_count" greater than 0
    And the response contains field "rate" as a number between 0 and 1

  Scenario: Measure run degrades gracefully when Digicore ELM runtime is unavailable
    Given the Digicore ELM runtime is configured to return 503 for all requests
    When a measure run is requested for the synthetic measure
    Then the Temporal workflow "qualitronRunMeasure" completes without crashing
    And the "qual.measure_run" row has status "complete"
    And the "qual.measure_report" row for "m_synth_ma_001" has an error status
    And no "qual.gap" row is created for "m_synth_ma_001"
