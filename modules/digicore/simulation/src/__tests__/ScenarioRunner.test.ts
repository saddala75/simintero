import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';
import { ScenarioRunner } from '../runner/ScenarioRunner.js';
import type { RuntimeClient } from '../runner/ScenarioRunner.js';
import type { SimulationRunInput } from '../schema/SimulationRun.js';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['DIG'] },
  roles: [],
  principal_type: 'service' as const,
};

const mockRuntime: RuntimeClient = {
  evaluate: vi.fn(async (evidence, _pins) => {
    const diag = evidence['diagnosis_documented'];
    const therapy = evidence['conservative_therapy_tried'];
    const imaging = evidence['imaging_documented'];
    if (therapy === 'indeterminate') return { outcome: 'indeterminate', trace_ref: 'trace:mock' };
    if (diag === true && therapy === true && imaging === true)
      return { outcome: 'meets_all', trace_ref: 'trace:mock' };
    return { outcome: 'not_met', trace_ref: 'trace:mock' };
  }),
};

function makeDb(
  capturedQueries: Array<{ sql: string; params: unknown[] }> = [],
): TenantDb {
  return {
    transaction: vi.fn(async (fn) => {
      const client = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          capturedQueries.push({ sql, params: params ?? [] });
          return { rows: [] };
        }),
      };
      return fn(client);
    }),
  };
}

const TEST_CASES: SimulationRunInput['test_cases'] = [
  {
    test_case_id: 'case-a',
    evidence: { diagnosis_documented: true, conservative_therapy_tried: true, imaging_documented: true },
    expected_outcome: 'meets_all',
  },
  {
    test_case_id: 'case-b',
    evidence: { diagnosis_documented: true, conservative_therapy_tried: true, imaging_documented: false },
    expected_outcome: 'not_met',
    expected_gaps: ['imaging_documented'],
  },
  {
    test_case_id: 'case-c',
    evidence: { diagnosis_documented: true, conservative_therapy_tried: 'indeterminate', imaging_documented: true },
    expected_outcome: 'indeterminate',
  },
];

describe('ScenarioRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('all 3 knee-arthroscopy test cases pass', async () => {
    const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb(capturedQueries);
    const runner = new ScenarioRunner(mockRuntime, db);

    const input: SimulationRunInput = {
      run_id: 'run-test-001',
      artifact_version_pins: ['pin:knee-arthroscopy:1.0.0'],
      triggered_by: 'test-suite',
      test_cases: TEST_CASES,
    };

    const report = await withTenantContext(TEST_CONTEXT, () => runner.run(input));

    // All 3 results should pass
    expect(report.results).toHaveLength(3);
    for (const result of report.results) {
      expect(result.passed, `${result.test_case_id} should pass`).toBe(true);
    }

    // Pass rate should be 1.0
    expect(report.pass_rate).toBe(1.0);
    expect(report.passed).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.total).toBe(3);
  });

  it('case-a returns meets_all', async () => {
    const db = makeDb();
    const runner = new ScenarioRunner(mockRuntime, db);

    const input: SimulationRunInput = {
      run_id: 'run-test-002',
      artifact_version_pins: [],
      triggered_by: 'test',
      test_cases: [TEST_CASES[0]!],
    };

    const report = await withTenantContext(TEST_CONTEXT, () => runner.run(input));

    expect(report.results[0]?.actual_outcome).toBe('meets_all');
    expect(report.results[0]?.passed).toBe(true);
  });

  it('case-b returns not_met', async () => {
    const db = makeDb();
    const runner = new ScenarioRunner(mockRuntime, db);

    const input: SimulationRunInput = {
      run_id: 'run-test-003',
      artifact_version_pins: [],
      triggered_by: 'test',
      test_cases: [TEST_CASES[1]!],
    };

    const report = await withTenantContext(TEST_CONTEXT, () => runner.run(input));

    expect(report.results[0]?.actual_outcome).toBe('not_met');
    expect(report.results[0]?.passed).toBe(true);
  });

  it('case-c returns indeterminate', async () => {
    const db = makeDb();
    const runner = new ScenarioRunner(mockRuntime, db);

    const input: SimulationRunInput = {
      run_id: 'run-test-004',
      artifact_version_pins: [],
      triggered_by: 'test',
      test_cases: [TEST_CASES[2]!],
    };

    const report = await withTenantContext(TEST_CONTEXT, () => runner.run(input));

    expect(report.results[0]?.actual_outcome).toBe('indeterminate');
    expect(report.results[0]?.passed).toBe(true);
  });

  it('simulation_result INSERTs are captured for all 3 cases', async () => {
    const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb(capturedQueries);
    const runner = new ScenarioRunner(mockRuntime, db);

    const input: SimulationRunInput = {
      run_id: 'run-test-005',
      artifact_version_pins: ['pin:v1'],
      triggered_by: 'test-suite',
      test_cases: TEST_CASES,
    };

    await withTenantContext(TEST_CONTEXT, () => runner.run(input));

    // One simulation_run INSERT + 3 simulation_result INSERTs
    const resultInserts = capturedQueries.filter((q) =>
      q.sql.includes('dig.simulation_result'),
    );
    expect(resultInserts).toHaveLength(3);

    // Each result INSERT should carry the correct test_case_id
    const insertedCaseIds = resultInserts.map((q) => q.params[3]);
    expect(insertedCaseIds).toContain('case-a');
    expect(insertedCaseIds).toContain('case-b');
    expect(insertedCaseIds).toContain('case-c');
  });

  it('simulation_run INSERT appears with status completed', async () => {
    const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb(capturedQueries);
    const runner = new ScenarioRunner(mockRuntime, db);

    const input: SimulationRunInput = {
      run_id: 'run-test-006',
      artifact_version_pins: [],
      triggered_by: 'test',
      test_cases: TEST_CASES,
    };

    await withTenantContext(TEST_CONTEXT, () => runner.run(input));

    const runInsert = capturedQueries.find((q) => q.sql.includes('dig.simulation_run'));
    expect(runInsert).toBeDefined();
    expect(runInsert?.sql).toContain("'completed'");
    expect(runInsert?.params[0]).toBe('run-test-006');
    expect(runInsert?.params[1]).toBe('t_test');
  });

  it('uses exact pins from input — never re-resolved', async () => {
    const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb(capturedQueries);
    const runner = new ScenarioRunner(mockRuntime, db);

    const pins = ['pin:exact:abc123', 'pin:exact:def456'];
    const input: SimulationRunInput = {
      run_id: 'run-test-007',
      artifact_version_pins: pins,
      triggered_by: 'test',
      test_cases: [TEST_CASES[0]!],
    };

    await withTenantContext(TEST_CONTEXT, () => runner.run(input));

    expect(mockRuntime.evaluate).toHaveBeenCalledWith(
      TEST_CASES[0]!.evidence,
      pins,
    );
  });

  it('throws when called outside tenant context', async () => {
    const db = makeDb();
    const runner = new ScenarioRunner(mockRuntime, db);

    const input: SimulationRunInput = {
      run_id: 'run-test-008',
      artifact_version_pins: [],
      triggered_by: 'test',
      test_cases: [TEST_CASES[0]!],
    };

    await expect(runner.run(input)).rejects.toThrow('No tenant context');
  });
});
