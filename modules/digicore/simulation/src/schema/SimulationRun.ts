export type OutcomeValue = 'meets_all' | 'partial' | 'not_met' | 'indeterminate';

export interface TestCase {
  test_case_id: string;
  evidence: Record<string, unknown>;
  expected_outcome: OutcomeValue;
  expected_gaps?: string[];
}

export interface SimulationRunInput {
  run_id: string;
  artifact_version_pins: string[];   // pins to use for evaluation
  triggered_by: string;
  test_cases: TestCase[];
}

export interface SimulationResult {
  result_id: string;
  run_id: string;
  test_case_id: string;
  expected_outcome: OutcomeValue;
  actual_outcome: OutcomeValue;
  passed: boolean;
  trace_ref: string;
}

export interface SimulationRunReport {
  run_id: string;
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  results: SimulationResult[];
  regressions: RegressionEntry[];
}

export interface RegressionEntry {
  test_case_id: string;
  prior_outcome: OutcomeValue;
  current_outcome: OutcomeValue;
}
