import { describe, it, expect } from 'vitest';
import { SimulationReport } from '../report/SimulationReport.js';
import type { SimulationResult } from '../schema/SimulationRun.js';
import type { PriorRunResult } from '../report/SimulationReport.js';

function makeResult(
  test_case_id: string,
  expected_outcome: SimulationResult['expected_outcome'],
  actual_outcome: SimulationResult['actual_outcome'],
): SimulationResult {
  return {
    result_id: `result-${test_case_id}`,
    run_id: 'run-001',
    test_case_id,
    expected_outcome,
    actual_outcome,
    passed: expected_outcome === actual_outcome,
    trace_ref: 'trace:test',
  };
}

describe('SimulationReport.detect_regressions', () => {
  const report = new SimulationReport();

  it('flags case where outcome changed from meets_all to not_met', () => {
    const current: SimulationResult[] = [
      makeResult('case-a', 'not_met', 'not_met'),
    ];
    const prior: PriorRunResult[] = [
      { test_case_id: 'case-a', outcome: 'meets_all' },
    ];

    const regressions = report.detect_regressions(current, prior);

    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatchObject({
      test_case_id: 'case-a',
      prior_outcome: 'meets_all',
      current_outcome: 'not_met',
    });
  });

  it('does NOT flag unchanged outcomes', () => {
    const current: SimulationResult[] = [
      makeResult('case-a', 'meets_all', 'meets_all'),
      makeResult('case-b', 'not_met', 'not_met'),
    ];
    const prior: PriorRunResult[] = [
      { test_case_id: 'case-a', outcome: 'meets_all' },
      { test_case_id: 'case-b', outcome: 'not_met' },
    ];

    const regressions = report.detect_regressions(current, prior);

    expect(regressions).toHaveLength(0);
  });

  it('returns no regressions when there are no prior results', () => {
    const current: SimulationResult[] = [
      makeResult('case-a', 'meets_all', 'meets_all'),
      makeResult('case-b', 'not_met', 'not_met'),
    ];

    const regressions = report.detect_regressions(current, []);

    expect(regressions).toHaveLength(0);
  });

  it('handles multiple regressions in a single run', () => {
    const current: SimulationResult[] = [
      makeResult('case-a', 'not_met', 'not_met'),
      makeResult('case-c', 'meets_all', 'meets_all'),
    ];
    const prior: PriorRunResult[] = [
      { test_case_id: 'case-a', outcome: 'meets_all' },
      { test_case_id: 'case-c', outcome: 'not_met' },
    ];

    const regressions = report.detect_regressions(current, prior);

    expect(regressions).toHaveLength(2);
    const caseA = regressions.find((r) => r.test_case_id === 'case-a');
    const caseC = regressions.find((r) => r.test_case_id === 'case-c');
    expect(caseA).toMatchObject({ prior_outcome: 'meets_all', current_outcome: 'not_met' });
    expect(caseC).toMatchObject({ prior_outcome: 'not_met', current_outcome: 'meets_all' });
  });

  it('ignores prior entries that have no matching current result', () => {
    const current: SimulationResult[] = [
      makeResult('case-a', 'meets_all', 'meets_all'),
    ];
    const prior: PriorRunResult[] = [
      { test_case_id: 'case-a', outcome: 'meets_all' },
      { test_case_id: 'case-z', outcome: 'not_met' },  // no current counterpart
    ];

    const regressions = report.detect_regressions(current, prior);

    expect(regressions).toHaveLength(0);
  });
});

describe('SimulationReport.summarize', () => {
  const report = new SimulationReport();

  it('computes correct pass rate with all passing', () => {
    const results: SimulationResult[] = [
      makeResult('case-a', 'meets_all', 'meets_all'),
      makeResult('case-b', 'not_met', 'not_met'),
      makeResult('case-c', 'indeterminate', 'indeterminate'),
    ];

    const summary = report.summarize(results);

    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(3);
    expect(summary.failed).toBe(0);
    expect(summary.pass_rate).toBe(1.0);
  });

  it('computes correct pass rate with partial failures', () => {
    const results: SimulationResult[] = [
      makeResult('case-a', 'meets_all', 'meets_all'),
      makeResult('case-b', 'not_met', 'meets_all'),  // failed
    ];

    const summary = report.summarize(results);

    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.pass_rate).toBe(0.5);
  });

  it('handles empty results gracefully', () => {
    const summary = report.summarize([]);

    expect(summary.total).toBe(0);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.pass_rate).toBe(0);
  });
});
