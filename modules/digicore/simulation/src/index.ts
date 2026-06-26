import '@sim/otel'
import { enrichSpan } from '@sim/otel'
import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';
import { ScenarioRunner } from './runner/ScenarioRunner.js';
import type { RuntimeClient } from './runner/ScenarioRunner.js';
import { SimulationReport } from './report/SimulationReport.js';
import type { TestCase } from './schema/SimulationRun.js';

export { ScenarioRunner } from './runner/ScenarioRunner.js';
export type { RuntimeClient } from './runner/ScenarioRunner.js';
export { HistoricalReplayer } from './runner/HistoricalReplayer.js';
export { SimulationReport } from './report/SimulationReport.js';
export type { PriorRunResult } from './report/SimulationReport.js';
export type {
  OutcomeValue,
  TestCase,
  SimulationRunInput,
  SimulationResult,
  SimulationRunReport,
  RegressionEntry,
} from './schema/SimulationRun.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_CASES_DIR = join(
  __dirname,
  '../../../../artifacts/synthetic/policies/knee-arthroscopy/test-cases',
);

function loadDefaultTestCases(): TestCase[] {
  const files = [
    'case-a-meets-all.json',
    'case-b-imaging-missing.json',
    'case-c-indeterminate.json',
  ];
  return files.map((f) => JSON.parse(readFileSync(join(TEST_CASES_DIR, f), 'utf-8')) as TestCase);
}

const app: Express = express();
app.use(express.json());

// Dependency injection — set before starting
let tenantDb: TenantDb | null = null;

export function setDb(db: TenantDb): void {
  tenantDb = db;
}

app.use((req: Request, _res: Response, next: NextFunction) => {
  const tenantId = (req as any).tenantId ?? (req.headers['x-tenant-id'] as string | undefined)
  const sub = (req as any).sub as string | undefined
  if (tenantId) enrichSpan({ tenant_id: tenantId })
  if (sub) enrichSpan({ 'user.sub': sub })
  next()
})

const runtimeBaseUrl = process.env['RUNTIME_BASE_URL'] ?? 'http://localhost:3020';

const httpRuntimeClient: RuntimeClient = {
  async evaluate(evidence, pins) {
    const resp = await fetch(`${runtimeBaseUrl}/v1/runtime/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evidence, pins }),
    });
    if (!resp.ok) {
      throw new Error(`Runtime evaluate failed: HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as Record<string, unknown>;
    return {
      outcome: String(data['outcome'] ?? ''),
      trace_ref: String(data['trace_ref'] ?? ''),
    };
  },
};

function requireDb(_req: Request, res: Response, next: NextFunction): void {
  if (!tenantDb) {
    res.status(503).json({ error: 'Service not initialised' });
    return;
  }
  next();
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'digicore-simulation' });
});

app.post(
  '/v1/simulation/runs',
  requireDb,
  async (req: Request, res: Response): Promise<void> => {
    const tenantCtx = ctx();

    const body = req.body as {
      artifact_version_pins?: unknown;
      triggered_by?: unknown;
      test_cases?: unknown;
    };

    if (body.artifact_version_pins !== undefined && !Array.isArray(body.artifact_version_pins)) {
      res.status(400).json({ error: 'artifact_version_pins must be an array' });
      return;
    }
    if (body.test_cases !== undefined && !Array.isArray(body.test_cases)) {
      res.status(400).json({ error: 'test_cases must be an array' });
      return;
    }

    const artifact_version_pins = Array.isArray(body.artifact_version_pins)
      ? (body.artifact_version_pins as string[])
      : [];

    const triggered_by =
      typeof body.triggered_by === 'string' ? body.triggered_by : tenantCtx.tenant_id;

    const test_cases = Array.isArray(body.test_cases)
      ? (body.test_cases as TestCase[])
      : loadDefaultTestCases();

    const runner = new ScenarioRunner(httpRuntimeClient, tenantDb!);
    const reportBuilder = new SimulationReport();

    const run_id = randomUUID();

    try {
      const report = await runner.run({
        run_id,
        artifact_version_pins,
        triggered_by,
        test_cases,
      });

      // Phase 1: no prior run — regressions are always empty
      const regressions = reportBuilder.detect_regressions(report.results, []);
      res.status(201).json({ ...report, regressions });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

export default app;

if (process.env['NODE_ENV'] !== 'test') {
  const port = Number(process.env['PORT'] ?? 3050);
  app.listen(port, () => {
    console.log(`[digicore-simulation] listening on :${port}`);
  });
}
