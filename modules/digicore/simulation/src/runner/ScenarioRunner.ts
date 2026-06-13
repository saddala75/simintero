import { randomUUID } from 'node:crypto';
import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';
import type {
  SimulationRunInput,
  SimulationResult,
  SimulationRunReport,
  OutcomeValue,
} from '../schema/SimulationRun.js';

export interface RuntimeClient {
  evaluate(
    evidence: Record<string, unknown>,
    pins: string[],
  ): Promise<{
    outcome: string;
    trace_ref: string;
  }>;
}

const VALID_OUTCOMES = new Set<string>(['meets_all', 'partial', 'not_met', 'indeterminate']);

function toOutcomeValue(value: string): OutcomeValue {
  if (VALID_OUTCOMES.has(value)) {
    return value as OutcomeValue;
  }
  throw new Error(`Invalid outcome value from runtime: ${value}`);
}

export class ScenarioRunner {
  constructor(
    private readonly runtimeClient: RuntimeClient,
    private readonly db: TenantDb,
  ) {}

  async run(input: SimulationRunInput): Promise<SimulationRunReport> {
    const { tenant_id } = ctx();

    // Evaluate all test cases — pins come exactly from input, never re-resolved
    const results: SimulationResult[] = [];
    for (const testCase of input.test_cases) {
      const { outcome, trace_ref } = await this.runtimeClient.evaluate(
        testCase.evidence,
        input.artifact_version_pins,
      );

      const actual_outcome = toOutcomeValue(outcome);
      results.push({
        result_id: randomUUID(),
        run_id: input.run_id,
        test_case_id: testCase.test_case_id,
        expected_outcome: testCase.expected_outcome,
        actual_outcome,
        passed: actual_outcome === testCase.expected_outcome,
        trace_ref,
      });
    }

    // Write atomically: simulation_run first, then all simulation_results
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO dig.simulation_run
           (run_id, tenant_id, artifact_version_pins, triggered_by, status)
         VALUES ($1, $2, $3, $4, 'completed')`,
        [
          input.run_id,
          tenant_id,
          JSON.stringify(input.artifact_version_pins),
          input.triggered_by,
        ],
      );

      for (const result of results) {
        await client.query(
          `INSERT INTO dig.simulation_result
             (result_id, run_id, tenant_id, test_case_id, expected_outcome, actual_outcome, trace_ref)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            result.result_id,
            result.run_id,
            tenant_id,
            result.test_case_id,
            result.expected_outcome,
            result.actual_outcome,
            result.trace_ref,
          ],
        );
      }
    });

    const passedCount = results.filter((r) => r.passed).length;
    const total = results.length;

    return {
      run_id: input.run_id,
      total,
      passed: passedCount,
      failed: total - passedCount,
      pass_rate: total === 0 ? 0 : passedCount / total,
      results,
      regressions: [],
    };
  }
}
