import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { TestCase, SimulationRunReport } from '../schema/SimulationRun.js';

// ── Mocks must be declared before importing the module ──────────────────────

const mockReplay = vi.fn<() => Promise<TestCase[]>>();
vi.mock('../runner/HistoricalReplayer.js', () => ({
  HistoricalReplayer: vi.fn().mockImplementation(() => ({ replay: mockReplay })),
}));

const mockRun = vi.fn<(input: unknown) => Promise<SimulationRunReport>>();
vi.mock('../runner/ScenarioRunner.js', () => ({
  ScenarioRunner: vi.fn().mockImplementation(() => ({ run: mockRun })),
}));

vi.mock('../report/SimulationReport.js', () => ({
  SimulationReport: vi.fn().mockImplementation(() => ({
    detect_regressions: vi.fn().mockReturnValue([]),
  })),
}));

// ── Tenant context mock ──────────────────────────────────────────────────────
vi.mock('@sim/tenant-context-ts', () => ({
  ctx: vi.fn().mockReturnValue({
    tenant_id: 't_test',
    cell_id: 'cell-pooled-us1',
    tier: 'pooled',
    scopes: { lob: ['MA'], region: ['TX'], modules: ['DIG'] },
    roles: [],
    principal_type: 'service',
  }),
  enrichSpan: vi.fn(),
}));

vi.mock('@sim/otel', () => ({ default: undefined, enrichSpan: vi.fn() }));

// ── Import the app after mocks ──────────────────────────────────────────────
const { default: app, setDb } = await import('../index.js');

const TEST_CASE: TestCase = {
  test_case_id: 'case-a',
  evidence: { diagnosis_documented: true, conservative_therapy_tried: true, imaging_documented: true },
  expected_outcome: 'meets_all',
};

const MOCK_REPORT: SimulationRunReport = {
  run_id: 'run-historical-001',
  total: 1,
  passed: 1,
  failed: 0,
  pass_rate: 1.0,
  results: [
    {
      result_id: 'result-001',
      run_id: 'run-historical-001',
      test_case_id: 'case-a',
      expected_outcome: 'meets_all',
      actual_outcome: 'meets_all',
      passed: true,
      trace_ref: 'trace:mock',
    },
  ],
  regressions: [],
};

describe('POST /v1/simulation/historical-runs', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Provide a minimal TenantDb so requireDb passes
    setDb({
      transaction: vi.fn(async (fn) => {
        const client = { query: vi.fn(async () => ({ rows: [] })) };
        return fn(client);
      }),
    } as any);

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, '127.0.0.1', resolve);
    });
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => {
    server?.close();
  });

  it('returns 201 with run_id when HistoricalReplayer returns 1 test case', async () => {
    mockReplay.mockResolvedValueOnce([TEST_CASE]);
    mockRun.mockResolvedValueOnce(MOCK_REPORT);

    const resp = await fetch(`${baseUrl}/v1/simulation/historical-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 't_test' },
      body: JSON.stringify({ artifact_version_pins: ['pin:v1'], triggered_by: 'test-suite' }),
    });

    expect(resp.status).toBe(201);
    const body = (await resp.json()) as SimulationRunReport;
    expect(body.run_id).toBeDefined();
    expect(typeof body.run_id).toBe('string');
    expect(body.total).toBe(1);
    expect(body.passed).toBe(1);
  });

  it('returns 400 when artifact_version_pins is not an array', async () => {
    const resp = await fetch(`${baseUrl}/v1/simulation/historical-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 't_test' },
      body: JSON.stringify({ artifact_version_pins: 'not-an-array' }),
    });

    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toContain('artifact_version_pins');
  });
});
