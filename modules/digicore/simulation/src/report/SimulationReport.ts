import type { SimulationResult, RegressionEntry, OutcomeValue } from '../schema/SimulationRun.js';

export interface PriorRunResult {
  test_case_id: string;
  outcome: OutcomeValue;
}

export class SimulationReport {
  detect_regressions(
    currentResults: SimulationResult[],
    priorResults: PriorRunResult[],
  ): RegressionEntry[] {
    const priorMap = new Map<string, OutcomeValue>();
    for (const prior of priorResults) {
      priorMap.set(prior.test_case_id, prior.outcome);
    }

    const regressions: RegressionEntry[] = [];
    for (const current of currentResults) {
      const prior_outcome = priorMap.get(current.test_case_id);
      if (prior_outcome !== undefined && prior_outcome !== current.actual_outcome) {
        regressions.push({
          test_case_id: current.test_case_id,
          prior_outcome,
          current_outcome: current.actual_outcome,
        });
      }
    }
    return regressions;
  }

  summarize(results: SimulationResult[]): {
    total: number;
    passed: number;
    failed: number;
    pass_rate: number;
  } {
    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    return {
      total,
      passed,
      failed: total - passed,
      pass_rate: total === 0 ? 0 : passed / total,
    };
  }
}
