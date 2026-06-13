import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { qualitronRunMeasure } from '../workflows/QualitronRunMeasure.js';
import { createRunsRouter } from '../routes/runs.js';
import type { MeasureResult } from '../activities/evaluateMeasure.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePool(rows: unknown[] = []): Pool {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as Pool;
}

const VALID_MEASURE_RESULT: MeasureResult = {
  member_id: 'mem_001',
  measure_ref: 'hedis:BCS-E',
  numerator: true,
  denominator: true,
  exclusion: false,
  evidence_refs: ['ev_1'],
  trace_ref: 'trace_abc',
};

const RUN_INPUT = {
  run_id: 'run_01J',
  tenant_id: 'tenant_abc',
  measure_ref: 'hedis:BCS-E',
  measure_version: '2024',
  period_start: '2024-01-01',
  period_end: '2024-12-31',
};

// ---------------------------------------------------------------------------
// qualitronRunMeasure workflow tests
// ---------------------------------------------------------------------------

describe('qualitronRunMeasure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns { total: 0, failed: 0 } when no eligible members', async () => {
    const pool = makePool([]);
    // First query is UPDATE status='running', second is SELECT members (empty), third is UPDATE status='complete'
    (pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [] })   // UPDATE running
      .mockResolvedValueOnce({ rows: [] })   // fetchEligibleMembers
      .mockResolvedValueOnce({ rows: [] });  // UPDATE complete

    const result = await qualitronRunMeasure(RUN_INPUT, pool, 'http://digicore.internal');

    expect(result).toEqual({ run_id: 'run_01J', total: 0, failed: 0 });
  });

  it('calls evaluateMeasure for each eligible member', async () => {
    const pool = makePool([]);
    (pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [] })  // UPDATE running
      .mockResolvedValueOnce({ rows: [{ member_id: 'mem_001' }, { member_id: 'mem_002' }] })  // fetchEligibleMembers
      .mockResolvedValue({ rows: [] });     // all subsequent queries (persist x2 x2, UPDATE complete)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ numerator: true, denominator: true }),
    }));

    const result = await qualitronRunMeasure(RUN_INPUT, pool, 'http://digicore.internal');

    expect(result.total).toBe(2);
    // fetch called twice — once per member
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://digicore.internal/v1/runtime/evaluate');
  });

  it('counts as failed when evaluateMeasure returns null (non-ok response)', async () => {
    const pool = makePool([]);
    (pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [] })  // UPDATE running
      .mockResolvedValueOnce({ rows: [{ member_id: 'mem_001' }, { member_id: 'mem_002' }] })
      .mockResolvedValue({ rows: [] });     // UPDATE complete

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }));

    const result = await qualitronRunMeasure(RUN_INPUT, pool, 'http://digicore.internal');

    expect(result.total).toBe(2);
    expect(result.failed).toBe(2);
  });

  it('persists measure report when evaluateMeasure returns a valid result', async () => {
    const pool = makePool([]);
    const queryMock = pool.query as ReturnType<typeof vi.fn>;
    queryMock
      .mockResolvedValueOnce({ rows: [] })  // UPDATE running
      .mockResolvedValueOnce({ rows: [{ member_id: 'mem_001' }] })  // fetchEligibleMembers
      .mockResolvedValueOnce({ rows: [] })  // INSERT measure_report
      .mockResolvedValueOnce({ rows: [] })  // INSERT shared.outbox
      .mockResolvedValueOnce({ rows: [] }); // UPDATE complete

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        numerator: true,
        denominator: true,
        exclusion: false,
        evidence_refs: ['ev_1'],
        trace_ref: 'trace_abc',
      }),
    }));

    await qualitronRunMeasure(RUN_INPUT, pool, 'http://digicore.internal');

    // Should have called INSERT INTO qual.measure_report and shared.outbox
    const insertReportCall = queryMock.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('qual.measure_report'),
    );
    const insertOutboxCall = queryMock.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('shared.outbox'),
    );

    expect(insertReportCall).toBeTruthy();
    expect(insertOutboxCall).toBeTruthy();

    // Validate outbox payload includes correct event_type
    const outboxParams = insertOutboxCall?.[1] as unknown[];
    const payload = JSON.parse(outboxParams?.[2] as string) as { event_type: string };
    expect(payload.event_type).toBe('MeasureReportCompleted');
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
