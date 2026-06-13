import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ElmResult } from '../compiler/CqlCompilerClient.js';

export type ExpectedOutcome = 'meets_all' | 'partial' | 'not_met' | 'indeterminate';

const VALID_OUTCOMES: ReadonlySet<string> = new Set<ExpectedOutcome>([
  'meets_all',
  'partial',
  'not_met',
  'indeterminate',
]);

export interface TestCase {
  test_case_id: string;
  evidence: Record<string, unknown>;
  expected_outcome: ExpectedOutcome;
}

export interface TestResult {
  test_case_id: string;
  passed: boolean;
  actual_outcome: string;
  expected_outcome: string;
}

export function evaluateEvidence(evidence: Record<string, unknown>): ExpectedOutcome {
  const values = Object.values(evidence);

  if (values.length === 0) return 'partial';

  if (values.some((v) => v === 'indeterminate')) return 'indeterminate';
  if (values.some((v) => v === false)) return 'not_met';
  if (values.every((v) => v === true)) return 'meets_all';
  return 'partial';
}

interface UnitTestRequestBody {
  library?: ElmResult;
  testCases?: unknown[];
}

export function createUnitTestRouter(): Router {
  const router = Router();

  router.post('/v1/authoring/unit-test', (req: Request, res: Response) => {
    const body = req.body as UnitTestRequestBody;

    if (!Array.isArray(body.testCases)) {
      res.status(400).json({ error: 'testCases must be an array' });
      return;
    }

    // Validate all test cases before processing
    const invalidCases: string[] = [];
    for (const tc of body.testCases) {
      if (typeof tc !== 'object' || tc === null) {
        res.status(400).json({ error: 'Invalid test case format' });
        return;
      }
      const testCase = tc as Record<string, unknown>;
      const outcome = testCase['expected_outcome'];
      if (typeof outcome !== 'string' || !VALID_OUTCOMES.has(outcome)) {
        const id = testCase['test_case_id'];
        invalidCases.push(typeof id === 'string' ? id : 'unknown');
      }
    }

    if (invalidCases.length > 0) {
      res.status(400).json({ error: 'Invalid expected_outcome', invalidCases });
      return;
    }

    const testCases = body.testCases as TestCase[];
    const results: TestResult[] = testCases.map((tc) => {
      const actual_outcome = evaluateEvidence(tc.evidence);
      return {
        test_case_id: tc.test_case_id,
        passed: actual_outcome === tc.expected_outcome,
        actual_outcome,
        expected_outcome: tc.expected_outcome,
      };
    });

    res.status(200).json({ results });
  });

  return router;
}
