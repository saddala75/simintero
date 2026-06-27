import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool, PoolClient } from 'pg';
import type { MeasureResult, MeasureSpec } from '../activities/evaluateMeasure.js';

// ---------------------------------------------------------------------------
// Mock the self-contained activities + the gaps handler so we can assert the
// orchestration calls the right steps. The measure_definition spec and the
// eligible-member set still come from client.query (the real fetchEligibleMembers
// is mocked, but the run's spec load is a direct query in the workflow).
// ---------------------------------------------------------------------------

const { evaluateMeasure, evaluateWithDigicore, persistMeasureReport, fetchEligibleMembers, handleMeasureReportCompleted } = vi.hoisted(() => ({
  evaluateMeasure: vi.fn(),
  evaluateWithDigicore: vi.fn(),
  persistMeasureReport: vi.fn(),
  fetchEligibleMembers: vi.fn(),
  handleMeasureReportCompleted: vi.fn(),
}));

vi.mock('../activities/evaluateMeasure.js', () => ({ evaluateMeasure }));
vi.mock('../activities/evaluateWithDigicore.js', () => ({ evaluateWithDigicore }));
vi.mock('../activities/persistMeasureReport.js', () => ({ persistMeasureReport }));
vi.mock('../activities/fetchEligibleMembers.js', () => ({ fetchEligibleMembers }));
vi.mock('@sim/qualitron-gaps', () => ({ handleMeasureReportCompleted }));

const { qualitronRunMeasure } = await import('../workflows/QualitronRunMeasure.js');
const { createRunsRouter } = await import('../routes/runs.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePool(rows: unknown[] = []): Pool {
  const query = vi.fn().mockResolvedValue({ rows });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  return { query, connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
}

const SPEC: MeasureSpec = {
  numerator: { resource_type: 'Procedure', code: '77067' },
};

/**
 * Build a Pool whose connect() returns a mock client. The client's query is a
 * spy; the SELECT for the measure_definition spec resolves to `specRows`.
 */
function makeTxPool(
  specRows: Array<{ spec: MeasureSpec; digicore_library_ref?: string | null }>,
): { pool: Pool; query: ReturnType<typeof vi.fn> } {
  const rowsWithDefault = specRows.map((r) => ({
    digicore_library_ref: null,
    ...r,
  }));
  const query = vi.fn().mockImplementation((sql: string) => {
    if (typeof sql === 'string' && sql.includes('qual.measure_definition')) {
      return Promise.resolve({ rows: rowsWithDefault });
    }
    return Promise.resolve({ rows: [] });
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  return { pool, query };
}

function makeResult(memberId: string): MeasureResult {
  return {
    member_id: memberId,
    measure_ref: 'hedis:BCS-E',
    numerator: true,
    denominator: true,
    exclusion: false,
    evidence_refs: ['ev_1'],
    trace_ref: 'trace_abc',
  };
}

const RUN_INPUT = {
  run_id: 'run_01J',
  tenant_id: 'tenant_abc',
  measure_ref: 'hedis:BCS-E',
  measure_version: '1.0.0',
  period_start: '2024-01-01',
  period_end: '2024-12-31',
};

// ---------------------------------------------------------------------------
// qualitronRunMeasure workflow tests
// ---------------------------------------------------------------------------

describe('qualitronRunMeasure', () => {
  beforeEach(() => {
    evaluateMeasure.mockReset();
    evaluateWithDigicore.mockReset();
    persistMeasureReport.mockReset();
    fetchEligibleMembers.mockReset();
    handleMeasureReportCompleted.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs inside a tenant transaction: BEGIN, set sim.tenant_id, COMMIT', async () => {
    const { pool, query } = makeTxPool([{ spec: SPEC }]);
    fetchEligibleMembers.mockResolvedValue([]);

    await qualitronRunMeasure(RUN_INPUT, pool, 'http://task.internal');

    const sqls = query.mock.calls.map((c) => c[0] as string);
    expect(sqls).toContain('BEGIN');
    expect(sqls.some((s) => s.includes("set_config('sim.tenant_id'"))).toBe(true);
    expect(sqls).toContain('COMMIT');
  });

  it('transitions status running -> complete and loads the spec', async () => {
    const { pool, query } = makeTxPool([{ spec: SPEC }]);
    fetchEligibleMembers.mockResolvedValue([]);

    const result = await qualitronRunMeasure(RUN_INPUT, pool, 'http://task.internal');

    const sqls = query.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => s.includes("status = 'running'") || s.includes("status='running'"))).toBe(true);
    expect(sqls.some((s) => s.includes("status = 'complete'") || s.includes("status='complete'"))).toBe(true);
    expect(sqls.some((s) => s.includes('qual.measure_definition'))).toBe(true);
    expect(result).toEqual({ run_id: 'run_01J', total: 0, failed: 0 });
  });

  it('marks the run failed when the measure definition is missing', async () => {
    const { pool, query } = makeTxPool([]); // no spec row
    fetchEligibleMembers.mockResolvedValue(['mem_001']);

    const result = await qualitronRunMeasure(RUN_INPUT, pool, 'http://task.internal');

    const sqls = query.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => s.includes("status = 'failed'") || s.includes("status='failed'"))).toBe(true);
    expect(evaluateMeasure).not.toHaveBeenCalled();
    expect(result).toEqual({ run_id: 'run_01J', total: 0, failed: 0 });
  });

  it('evaluates, persists, and detects gaps for each eligible member', async () => {
    const { pool } = makeTxPool([{ spec: SPEC }]);
    fetchEligibleMembers.mockResolvedValue(['mem_001', 'mem_002']);
    evaluateMeasure.mockImplementation((_c, m: string) => Promise.resolve(makeResult(m)));
    persistMeasureReport.mockResolvedValue(undefined);
    handleMeasureReportCompleted.mockResolvedValue(undefined);

    const result = await qualitronRunMeasure(RUN_INPUT, pool, 'http://task.internal');

    expect(result.total).toBe(2);
    expect(result.failed).toBe(0);
    expect(evaluateMeasure).toHaveBeenCalledTimes(2);
    expect(persistMeasureReport).toHaveBeenCalledTimes(2);
    expect(handleMeasureReportCompleted).toHaveBeenCalledTimes(2);

    // evaluateMeasure receives the loaded spec
    expect(evaluateMeasure.mock.calls[0]?.[3]).toEqual(SPEC);

    // the gap handler is invoked with a MeasureReportCompleted payload
    const gapPayload = handleMeasureReportCompleted.mock.calls[0]?.[0] as { event_type: string; member_id: string };
    expect(gapPayload.event_type).toBe('MeasureReportCompleted');
    expect(gapPayload.member_id).toBe('mem_001');
    // ...and the task service url is forwarded
    expect(handleMeasureReportCompleted.mock.calls[0]?.[5]).toBe('http://task.internal');
  });

  it('counts a failed member without aborting the run (per-member try/catch)', async () => {
    const { pool } = makeTxPool([{ spec: SPEC }]);
    fetchEligibleMembers.mockResolvedValue(['mem_bad', 'mem_ok']);
    evaluateMeasure.mockImplementation((_c, m: string) => {
      if (m === 'mem_bad') return Promise.reject(new Error('boom'));
      return Promise.resolve(makeResult(m));
    });
    persistMeasureReport.mockResolvedValue(undefined);
    handleMeasureReportCompleted.mockResolvedValue(undefined);

    const result = await qualitronRunMeasure(RUN_INPUT, pool, 'http://task.internal');

    expect(result.total).toBe(2);
    expect(result.failed).toBe(1);
    expect(persistMeasureReport).toHaveBeenCalledTimes(1); // only the good member
  });

  it('calls evaluateWithDigicore (not evaluateMeasure) when digicore_library_ref is set', async () => {
    const { pool } = makeTxPool([{
      spec: SPEC,
      digicore_library_ref: 'https://artifacts.simintero.io/shared/cql_library/bcs-e',
    }]);
    fetchEligibleMembers.mockResolvedValue(['mem_001', 'mem_002']);
    evaluateWithDigicore.mockResolvedValue([
      { memberRef: 'mem_001', denominator: true, numerator: true, exclusion: false, exception: false, traceRef: 'tr-1' },
      { memberRef: 'mem_002', denominator: true, numerator: false, exclusion: false, exception: false, traceRef: 'tr-2' },
    ]);
    persistMeasureReport.mockResolvedValue(undefined);
    handleMeasureReportCompleted.mockResolvedValue(undefined);

    const result = await qualitronRunMeasure(RUN_INPUT, pool, 'http://task.internal');

    expect(result.total).toBe(2);
    expect(result.failed).toBe(0);
    // Digicore path: one batch call, not per-member legacy evaluateMeasure
    expect(evaluateWithDigicore).toHaveBeenCalledTimes(1);
    expect(evaluateMeasure).not.toHaveBeenCalled();
    expect(evaluateWithDigicore.mock.calls[0]?.[0]).toMatchObject({
      tenantId: RUN_INPUT.tenant_id,
      libraryRef: 'https://artifacts.simintero.io/shared/cql_library/bcs-e',
      memberRefs: ['mem_001', 'mem_002'],
    });
    // each result is persisted and gap-checked
    expect(persistMeasureReport).toHaveBeenCalledTimes(2);
    expect(handleMeasureReportCompleted).toHaveBeenCalledTimes(2);
    const gapPayload = handleMeasureReportCompleted.mock.calls[0]?.[0] as { event_type: string; member_id: string; numerator: boolean };
    expect(gapPayload.event_type).toBe('MeasureReportCompleted');
    expect(gapPayload.member_id).toBe('mem_001');
    expect(gapPayload.numerator).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/quality/runs route tests
// ---------------------------------------------------------------------------

const VALID_RUN_BODY = {
  measure_ref: 'hedis:BCS-E',
  measure_version: '2024',
  period_start: '2024-01-01',
  period_end: '2024-12-31',
};

describe('POST /v1/quality/runs', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(createRunsRouter(makePool()));
  });

  it('returns 401 when x-sim-tenant-id header is absent', async () => {
    const res = await request(app)
      .post('/v1/quality/runs')
      .send(VALID_RUN_BODY);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TENANT_ID');
  });

  it('returns 202 with run_id when request is valid', async () => {
    const res = await request(app)
      .post('/v1/quality/runs')
      .set('x-sim-tenant-id', 'tenant_abc')
      .send(VALID_RUN_BODY);

    expect(res.status).toBe(202);
    expect(res.body.run_id).toBeTruthy();
    expect(res.body.status).toBe('accepted');
  });

  it('returns 400 when measure_ref is absent', async () => {
    const { measure_ref: _omitted, ...bodyWithoutRef } = VALID_RUN_BODY;

    const res = await request(app)
      .post('/v1/quality/runs')
      .set('x-sim-tenant-id', 'tenant_abc')
      .send(bodyWithoutRef);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
  });
});

// ---------------------------------------------------------------------------
// GET /v1/quality/runs/:runId route tests
// ---------------------------------------------------------------------------

describe('GET /v1/quality/runs/:runId', () => {
  it('GET /runs/:runId — 401 when tenant header absent', async () => {
    const app = express();
    app.use(express.json());
    app.use(createRunsRouter(makePool()));

    const response = await request(app).get('/v1/quality/runs/some-id');
    expect(response.status).toBe(401);
  });

  it('returns 200 with the run row when found', async () => {
    const runRow = {
      run_id: 'run_01J',
      tenant_id: 'tenant_abc',
      measure_ref: 'hedis:BCS-E',
      measure_version: '2024',
      period_start: '2024-01-01',
      period_end: '2024-12-31',
      status: 'complete',
    };
    const pool = makePool([runRow]);

    const app = express();
    app.use(express.json());
    app.use(createRunsRouter(pool));

    const res = await request(app)
      .get('/v1/quality/runs/run_01J')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(res.body.run_id).toBe('run_01J');
    expect(res.body.status).toBe('complete');
  });

  it('returns 404 when run is not found', async () => {
    const pool = makePool([]);

    const app = express();
    app.use(express.json());
    app.use(createRunsRouter(pool));

    const res = await request(app)
      .get('/v1/quality/runs/run_missing')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
